// .. the refresh time of the page
var REFRESH_TIME_MILLIS = 3 * 60 * 1000;
//var REFRESH_TIME_MILLIS = 15000;

// .. the geo-coordinates of the Armbrust Lab
var armbrustLab = new google.maps.LatLng(47.6552966, -122.3214622);
// The ship tracks
var recentShipTimestamp = new Date(0);
var recentShipLocation = armbrustLab;
// .. the marker for the ship
var shipMarker = new google.maps.Marker({
  clickable : false,
  position : recentShipLocation,
  zIndex : google.MAX_ZINDEX + 1,
  icon : {
    url : 'ships/rv_kilo_moana_alpha.png',
    anchor : new google.maps.Point(40, 40),
    scaledSize : new google.maps.Size(40, 40)
  }
});
var unselectedCruisePath1, unselectedCruisePath2, selectedCruisePath;
// The bounds of the known points in the map
var mapBounds = new google.maps.LatLngBounds();
var map;
var mapLocs = [];
// Whether the map has been zoomed yet
var hasZoomed = false;
// SQLShare REST server for queries
var sqlshare_query_url = 'https://rest.sqlshare.escience.washington.edu/REST.svc/execute?sql=';

var charts = {};
// Short names for populations in database
var popNames = ["prochloro", "synecho", "picoeuk", "beads"];
// Full names for legend
var popLabels = ["Prochlorococcus", "Synechococcus", "Picoeukaryotes", "Beads"];
// Lookup table between pop database shortnames / object keys and common names
var popLookup = {};
for (var i = 0; i < popNames.length; i++) {
    popLookup[popNames[i]] = popLabels[i];
    popLookup[popLabels[i]] = popNames[i];
}
var groups = {};
var timeDims = {};
var rangeDims = {};
var timePopDims = {};
var cstarDims = {};
var popDim;
var timeRange = null;
var sflxf;
var rangexf;
var popxf;
var cstarxf;
var labelFormat = d3.time.format.utc("%Y-%m-%d %H:%M:%S GMT");  // format for chart point label time
var timeFormat = d3.time.format.utc("%m/%d/%Y %H:%M:%S %p");    // parse UTC Date for SQLShare time field
var pinnedToMostRecent = false;  // should time selection be pinned to most recent data?
var yDomains = {
    rangeChart: [0, 0.3],
    velocity: [0, 20],
    ocean_tmp: null,
    salinity: null,
    par: null,
    attenuation: [0, 0.3],
    conc: null,
    size: null
};

// Track which populations should be shown in plots
var popFlags = {};
popNames.forEach(function(p) { popFlags[p] = true; });

var infobox;

dc.disableTransitions = true;

// Put the ship icon at the most recent location
function setupShipIcon() {
    console.log("setting ship at recent " + recentShipLocation + " " + labelFormat(recentShipTimestamp));
    shipMarker.setMap(map);
    shipMarker.setPosition(recentShipLocation);
}

function zoomMapToBounds() {
    map.fitBounds(mapBounds);
}

// Update the ship tracks
function getNewShipTracks() {
    console.log('refreshing ship tracks since ' + recentShipTimestamp);
    var query = "SELECT [time], lat, lon ";
    query += "FROM [seaflow.viz@gmail.com].[SFL_VIEW] ";
    query += "WHERE [time] > '" + (new Date(recentShipTimestamp.getTime() + 1000)).toISOString() + "' ";
    query += "ORDER BY [time] ASC";

    executeSqlQuery(query, function(jsonp) {
        var tracks = transformDataMap(jsonp);
        if (tracks.length == 0) {
            console.log('no new track points');
            return;
        } else {
            console.log(tracks.length + ' new track points');
        }
        // Update map bounding rectangle
        tracks.forEach(function(t) {
            mapBounds.extend(t.LatLng);
            mapLocs.push(t);
        });

        updateShipTracks();
    });
}

function updateShipTracks() {
    var t0 = new Date();
    // Create polyline for unselected cruise path
    if (unselectedCruisePath1) {
        unselectedCruisePath1.setMap(null);
    }
    if (unselectedCruisePath2) {
        unselectedCruisePath2.setMap(null);
    }
    if (selectedCruisePath) {
        selectedCruisePath.setMap(null);
    }
    var unselectedLocs1 = [],
        unselectedLocs2 = [],
        selectedLocs = [];
    if (timeRange) {
        unselectedLocs1 = mapLocs.filter(function(d) {
            return d.time < timeRange[0];
        }).map(function(d) {
            return d.LatLng;
        });
        unselectedLocs2 = mapLocs.filter(function(d) {
            return d.time > timeRange[1];
        }).map(function(d) {
            return d.LatLng;
        });
        selectedLocs = mapLocs.filter(function(d) {
            return d.time >= timeRange[0] && d.time <= timeRange[1];
        }).map(function(d) {
            return d.LatLng;
        });
    } else {
        selectedLocs = mapLocs.map(function(d) { return d.LatLng; });
    }

    unselectedCruisePath1 = new google.maps.Polyline({
        path: unselectedLocs1,
        geodesic: true,
        strokeColor: "#FFFFFF",
        strokeOpacity: 1.0,
        strokeWeight: 2
    });
    unselectedCruisePath1.setMap(map);
    unselectedCruisePath2 = new google.maps.Polyline({
        path: unselectedLocs2,
        geodesic: true,
        strokeColor: "#FFFFFF",
        strokeOpacity: 1.0,
        strokeWeight: 2
    });
    unselectedCruisePath2.setMap(map);

    selectedCruisePath = new google.maps.Polyline({
        path: selectedLocs,
        geodesic: true,
        strokeColor: "#FF0000",
        strokeOpacity: 1.0,
        strokeWeight: 2
    });
    selectedCruisePath.setMap(map);

    // Add ship icon
    if (recentShipTimestamp !== mapLocs[mapLocs.length-1].time) {
        recentShipLocation = mapLocs[mapLocs.length-1].LatLng;
        recentShipTimestamp = mapLocs[mapLocs.length-1].time;
        setupShipIcon();
    }

    // Only zoom to bounds once
    if (! hasZoomed) {
        zoomMapToBounds();
        hasZoomed = true;
    }

    //console.log("updateShipTracks took " + (((new Date().getTime()) - t0.getTime())/1000) + " sec");
}

function executeSqlQuery(query, cb) {
    var t0 = new Date();
    $.ajax({
        url : sqlshare_query_url + encodeURIComponent(query),
        dataType : 'jsonp',
        type : 'GET',
        jsonp : 'jsonp',
        crossDomain : 'true',
        error : function(xhr, ts, et) {
            alert("error errorThrow:" + et);
        },
        success : function(jsonp) {
            console.log("SQL query took " + (((new Date().getTime()) - t0.getTime())/1000) + " sec")
            cb(jsonp);
        }
    });
}

function logSqlQuery(query) {
    executeSqlQuery(query, function(jsonp) {
        console.log(jsonp);
    });
}

// Turn jsonp data from SQL share query result into an arrays of JSON objects
// that can be easily fed to crossfilter/dc.js
function transformData(jsonp) {
    if (jsonp.header.length < 2) {
        alert('Query ' + data.sql + ' returned ' + jsonp.header.length + ' columns, needs at least 2');
        return;
    }

    // Figure out which columns correspond to which column headers
    idx = {};
    for (var col = 0; col < jsonp.header.length; col++) {
        idx[jsonp.header[col]] = col;
    }

    var sflValues = [];    // environmental data
    var rangeValues = [];  // time selector
    var popValues = [];    // population data

    var msecMinute = 60 * 1000;
    var prevTime = null;
    for (var i in jsonp.data) {
        var curTime = timeFormat.parse(jsonp.data[i][idx["time"]]);

        // If this record is more than 4 minutes from last record, assume
        // records are missing and add a placeholder empty record. Only need 
        // one placeholder record per gap.  This placeholder record makes it
        // possible to draw line chart with gaps.
        if (i > 0 && (curTime - prevTime) > 4 * msecMinute) {
            sflValues.push({
                time: new Date(prevTime.getTime() + (3 * msecMinute)),
                salinity: null,
                ocean_tmp: null,
                par: null,
                velocity: null
            });
            rangeValues.push({
                time: new Date(prevTime.getTime() + (3 * msecMinute)),
                par: null
            });
            popNames.forEach(function(pn) {
                popValues.push({
                    time: new Date(prevTime.getTime() + (3 * msecMinute)),
                    size: null,
                    conc: null,
                    pop: pn
                });
            });
        }

        sflValues.push({
            time: curTime,
            ocean_tmp: jsonp.data[i][idx["ocean_tmp"]],
            salinity: jsonp.data[i][idx["salinity"]],
            par: Math.max(jsonp.data[i][idx["par"]], 0),
            velocity: jsonp.data[i][idx["velocity"]],
        });
        rangeValues.push({
            time: curTime,
            par: jsonp.data[i][idx["par"]]
        });
        popNames.forEach(function(pop) {
            popValues.push({
                time: curTime,
                conc: jsonp.data[i][idx[pop + "_conc"]],
                size: jsonp.data[i][idx[pop + "_size"]],
                pop: pop
            });
        });

        prevTime = curTime;
    }

    return { sfl: sflValues, range: rangeValues, pop: popValues };
}

function transformDataMap(jsonp) {
    // Figure out which columns correspond to which column headers
    idx = {};
    for (var col = 0; col < jsonp.header.length; col++) {
        idx[jsonp.header[col]] = col;
    }

    var coords = [];    // environmental data
    for (var i in jsonp.data) {
        coords.push({
            time: timeFormat.parse(jsonp.data[i][idx["time"]]),
            lat: jsonp.data[i][idx["lat"]],
            lon: jsonp.data[i][idx["lon"]],
            LatLng: new google.maps.LatLng(jsonp.data[i][idx["lat"]], jsonp.data[i][idx["lon"]])
        });
    }
    return coords;
}

// Turn jsonp data from SQL share query result into an arrays of JSON objects
// that can be easily fed to crossfilter/dc.js
function transformDataCSTAR(jsonp) {
    if (jsonp.header.length < 2) {
        alert('Query ' + data.sql + ' returned ' + jsonp.header.length + ' columns, needs at least 2');
        return;
    }

    // Figure out which columns correspond to which column headers
    idx = {};
    for (var col = 0; col < jsonp.header.length; col++) {
        idx[jsonp.header[col]] = col;
    }

    var cstarValues = [];    // cstar data

    var msecMinute = 60 * 1000;
    var prevTime = null;
    for (var i in jsonp.data) {
        var curTime = timeFormat.parse(jsonp.data[i][idx["time"]]);

        // If this record is more than 4 minutes from last record, assume
        // records are missing and add a placeholder empty record. Only need 
        // one placeholder record per gap.  This placeholder record makes it
        // possible to draw line chart with gaps.
        if (i > 0 && (curTime - prevTime) > 4 * msecMinute) {
            cstarValues.push({
                time: new Date(prevTime.getTime() + (3 * msecMinute)),
                attenuation: null,
                type: "whole"
            });
            cstarValues.push({
                time: new Date(prevTime.getTime() + (3 * msecMinute)),
                attenuation: null,
                type: "filtered"
            });
        }

        cstarValues.push({
            time: curTime,
            attenuation: jsonp.data[i][idx["attenuation"]],
            type: jsonp.data[i][idx["type"]]
        });

        prevTime = curTime;
    }

    return { cstar: cstarValues };
}

// Reduce functions to stop crossfilter from coercing null values to 0
// Allows chart.defined() to work as expected and create disconintinous
// line charts, while also differentiating between true 0 values and
// missing data.
function reduceAdd(key) {
    return function(p, v) {
        //console.log("adding: ", v.pop, v.time, v[key], p.count, p.total);
        if (v[key] !== null) {
            ++p.count;
        }
        // want to avoid coercing a null p.total to 0 by adding a null
        // v[key]
        if (p.total !== null || v[key] !== null) {
            p.total += v[key];
        }
        return p;
    }
}

function reduceRemove(key) {
    return function(p, v) {
        if (v[key] !== null) {
            --p.count;
        }
        // want to avoid coercing a null p.total to 0 by subtracting
        // a null v[key]
        if (p.total !== null || v[key] !== null) {
            p.total -= v[key];
        }
        return p;
    }
}

function reduceInitial() {
    return { count: 0, total: null };
}

function plotLineChart(key, yAxisLabel) {
    var chart = dc.lineChart("#" + key);
    charts[key] = chart;

    var minMaxTime = timeRange;
    var binSize = getBinSize(minMaxTime);
    var dim = timeDims[binSize];
    var group = groups[key][binSize];
    var yAxisDomain = yDomains[key] ? yDomains[key] : d3.extent(group.all(), valueAccessor);

    chart
        .width(480)
        .height(120)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(yAxisDomain))
        .brushOn(false)
        .clipPadding(10)
        .renderDataPoints({
            radius: 3,
            fillOpacity: 0.65,
            strokeOpacity: 1
        })
        .yAxisLabel(yAxisLabel)
        .xAxisLabel("Time (GMT)")
        .interpolate("cardinal")
        .dimension(dim)
        .group(group)
        .valueAccessor(valueAccessor)
        .defined(function(d) { return (d.y !== null); })  // don't plot segements with missing data
        .title(function(d) {
            return labelFormat(d.key) + '\n' + d3.format(".2f")(valueAccessor(d));
        });
    chart.margins().left = 60;
    chart.xAxis().ticks(6);
    chart.yAxis().ticks(4);
    chart.yAxis().tickFormat(d3.format(".2f"))
    chart.render();
}

function plotPopSeriesChart(key, yAxisLabel, legendFlag) {
    var chart = dc.seriesChart("#" + key);
    charts[key] = chart;

    var minMaxTime = timeRange;
    var binSize = getBinSize(minMaxTime);
    var dim = timePopDims[binSize];
    var group = groups[key][binSize];
    var yAxisDomain = yDomains[key] ? yDomains[key] : d3.extent(group.all(), valueAccessor);

    // As small performance improvement, hardcode substring positions since
    // we know the key is always something like "1426522573342_key" and the
    // length of the milliseconds string from Date.getTime() won't change until
    // 2286
    var keyAccessor = function(d) {
        return new Date(+(d.key.substr(0, 13)));
    };
    var seriesAccessor = function(d) {
        return popLookup[d.key.substr(14)];
    };

    var minMaxY = d3.extent(group.all(), valueAccessor);
    var legendHeight = 15;  // size of legend

    chart
        .width(1000)
        .height(300)
        .chart(dc.lineChart)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(yAxisDomain))
        .ordinalColors(["#FFBB78", "#FF7F0E", "#1F77B4", "#AEC7E8"])
        .renderHorizontalGridLines(true)
        .renderVerticalGridLines(true)
        .dimension(dim)
        .group(group)
        .seriesAccessor(seriesAccessor)
        .keyAccessor(keyAccessor)
        .valueAccessor(valueAccessor)
        .brushOn(false)
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .xAxisLabel("Time (GMT)")
        .title(function(d) {
            return labelFormat(keyAccessor(d)) + "\n" + d3.format(".2f")(valueAccessor(d));
        })
        .childOptions(
        {
            defined: function(d) {
                // don't plot segements with missing data
                return (d.y !== null);
            },
            interpolate: "cardinal",
            renderDataPoints: {
                radius: 3,
                fillOpacity: 0.65,
                strokeOpacity: 1
            }
        });
    chart.margins().left = 60;
    chart.yAxis().ticks(6);
    chart.yAxis().tickFormat(d3.format(".2f"))

    // Legend setup
    if (legendFlag) {
        chart.margins().top = legendHeight + 5;
        chart.legend(dc.legend()
            .x(600)
            .y(0)
            .itemHeight(legendHeight)
            .gap(10)
            .horizontal(true)
            .autoItemWidth(true)
        );
    } else {
        // adjust chart size so that plot area is same size as chart with legend
        chart.height(chart.height() - legendHeight + 5);
    }
    
    chart.render();
}

function plotRangeChart(yAxisLabel) {
    var key = "rangeChart"
    var chart = dc.lineChart("#" + key);
    charts[key] = chart;

    var minMaxTime = [rangeDims[1].bottom(1)[0].time, rangeDims[1].top(1)[0].time];
    var binSize = getBinSize(minMaxTime);
    var dim = rangeDims[binSize];
    var group = groups.rangeChart[binSize];
    var yAxisDomain = yDomains[key] ? yDomains[key] : d3.extent(group.all(), valueAccessor);

    chart
        .width(1000)
        .height(120)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(yAxisDomain))
        .interpolate("cardinal")
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        //.xAxisLabel("Time (GMT)")
        .dimension(dim)
        .group(group)
        .valueAccessor(valueAccessor)
        .defined(function(d) { return (d.y !== null); });  // don't plot segements with missing data
    chart.on("filtered", function(chart, filter) {
        dc.events.trigger(function() {
            if (filter !== null) {
                console.log("focus range set to " + filter.map(d3.time.format.utc("%Y-%m-%d %H:%M:%S %p")).join(" - "));
            }
            updateCharts();
            updateShipTracks();
        }, 600);
    });
    chart.margins().left = 60;
    chart.yAxis().ticks(4);
    chart.render();
}

function plotCSTARSeriesChart(key, yAxisLabel, legendFlag) {
    var chart = dc.seriesChart("#" + key);
    charts[key] = chart;

    var minMaxTime = timeRange;
    var binSize = getBinSize(minMaxTime);
    var dim = timePopDims[binSize];
    var group = groups[key][binSize];
    var yAxisDomain = yDomains[key] ? yDomains[key] : d3.extent(group.all(), valueAccessor);

    // As small performance improvement, hardcode substring positions since
    // we know the key is always something like "1426522573342_key" and the
    // length of the milliseconds string from Date.getTime() won't change until
    // 2286
    var keyAccessor = function(d) {
        return new Date(+(d.key.substr(0, 13)));
    };
    var seriesAccessor = function(d) {
        return d.key.substr(14);
    };

    var minMaxY = d3.extent(group.all(), valueAccessor);
    var legendHeight = 15;  // size of legend

    chart
        .width(480)
        .height(120)
        .chart(dc.lineChart)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(yAxisDomain))
        .ordinalColors(["#1F77B4", "#B18904"])
        .renderHorizontalGridLines(false)
        .renderVerticalGridLines(false)
        .dimension(dim)
        .group(group)
        .seriesAccessor(seriesAccessor)
        .keyAccessor(keyAccessor)
        .valueAccessor(valueAccessor)
        .brushOn(false)
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .xAxisLabel("Time (GMT)")
        .title(function(d) {
            return labelFormat(keyAccessor(d)) + "\n" + d3.format(".2f")(valueAccessor(d));
        })
        .childOptions(
        {
            defined: function(d) {
                // don't plot segements with missing data
                return (d.y !== null);
            },
            interpolate: "cardinal",
            renderDataPoints: {
                radius: 3,
                fillOpacity: 0.65,
                strokeOpacity: 1
            }
        });
    chart.margins().left = 60;
    chart.yAxis().ticks(6);
    chart.yAxis().tickFormat(d3.format(".2f"))

    // Legend setup
    if (legendFlag) {
        //chart.margins().top = legendHeight + 5;
        chart.legend(dc.legend()
            .x(320)
            .y(0)
            .itemHeight(legendHeight)
            .gap(10)
            .horizontal(true)
            .autoItemWidth(true)
        );
    } else {
        // adjust chart size so that plot area is same size as chart with legend
        chart.height(chart.height() - legendHeight + 5);
    }
    
    chart.render();
}

function updateCharts() {
    var t0 = new Date();

    // No time window selected, reset timeRange to entire cruise
    if (! charts.rangeChart || charts.rangeChart.filter() === null) {
        timeRange = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
    } else {
        // If a time window is selected and it extends to the latest time point
        // then we set pinnedToMostRecent to true to make sure window always
        // stays pinned to the right when new data is added
        if (charts.rangeChart.filter()[1].getTime() === timeDims[1].top(1)[0].time.getTime()) {
            pinnedToMostRecent = true;
            console.log("focus range pinned to most recent");
        } else {
            pinnedToMostRecent = false;
            console.log("focus range unpinned");
        }
        timeRange = charts.rangeChart.filter();  // set timeRange to filter window
    }

    var binSize = getBinSize(timeRange);
    console.log("points per bin = " + binSize);
    
    // Clear filters for instrument plots and population plots
    [1,2,3,4].forEach(function(binSize) {
        timeDims[binSize].filterAll();
        timePopDims[binSize].filterAll();
    });

    ["velocity", "ocean_tmp", "salinity", "par"].forEach(function(key) {
        if (charts[key]) {
            charts[key].dimension(timeDims[binSize]);
            charts[key].group(groups[key][binSize]);
            charts[key].expireCache();
            charts[key].x().domain(timeRange);
            recalculateY(charts[key], yDomains[key]);
            // clear DOM nodes to prevent memory leaks before render
            charts[key].resetSvg();
            charts[key].render();
        }
    });

    ["conc", "size"].forEach(function(key) {
        if (charts[key]) {
            charts[key].dimension(timePopDims[binSize]);
            charts[key].group(groups[key][binSize]);
            charts[key].expireCache();
            charts[key].x().domain(timeRange);
            recalculateY(charts[key], yDomains[key]);
            // clear DOM nodes to prevent memory leaks before render
            var s = charts[key].svg();
            charts[key].resetSvg();

            charts[key].render();
            configureLegendButtons(charts[key]);
        }
    });

    ["attenuation"].forEach(function(key) {
        if (charts[key]) {
            charts[key].dimension(timeDims[binSize]);
            charts[key].group(groups[key][binSize]);
            charts[key].expireCache();
            charts[key].x().domain(timeRange);
            recalculateY(charts[key], yDomains[key]);
            // clear DOM nodes to prevent memory leaks before render
            charts[key].resetSvg();
            charts[key].render();
        }
    });

    var t1 = new Date();
    //console.log("chart updates took " + (t1.getTime() - t0.getTime()) / 1000);
}

function updateRangeChart() {
    var t0 = new Date();
    if (charts.rangeChart !== undefined) {
        // Note: rangeChart always shows the full time range, not current value of
        // timeRange, which may be a user selected time window.
        // rangeChart gets it's own bin size because it's always based on total
        // time range, not based on a possibly user selected time range
        var totalTimeRange = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
        var rangeBinSize = getBinSize(totalTimeRange);

        // If we don't reset filters on dimensions here the re-render of the
        // time window selection will only show filtered data points if the
        // dimension changes.  This is due to the way crossfilter dimension
        // filtering works.
        var filter = charts.rangeChart.filter();
        if (filter !== null) {
            // If the focus range is pinned to the right of the x axis (most recent)
            // then 
            if (pinnedToMostRecent) {
                // how much time has been added
                var delta = totalTimeRange[1].getTime() - filter[1].getTime();
                // set right boundary to latest time
                filter[1] = totalTimeRange[1];
                // move left boundary forward by delta
                filter[0] = new Date(filter[0].getTime() + delta);
            }
            charts.rangeChart.dimension().filterAll();  // clear filter on current dim
            rangeDims[rangeBinSize].filter(filter);     // set filter on new dim
        }
        charts.rangeChart.dimension(rangeDims[rangeBinSize]);
        charts.rangeChart.group(groups.rangeChart[rangeBinSize]);
        charts.rangeChart.expireCache();
        if (! yDomains.rangeChart) {
            var yAxisDomain = d3.extent(groups.rangeChart[rangeBinSize].all(), valueAccessor);
        } else {
            var yAxisDomain = yDomains.rangeChart;
        }
        charts.rangeChart.x().domain(totalTimeRange);
        charts.rangeChart.y().domain(yAxisDomain);
        // Also need to reset the brush extent to compensate for any potential
        // shifts in the X axis
        if (filter !== null) {
            charts.rangeChart.brush().extent(filter);
        }
        // clear DOM nodes to prevent memory leaks before render
        charts.rangeChart.resetSvg();
        charts.rangeChart.render();
    }

    var t1 = new Date();
    //console.log("range chart update took " + (t1.getTime() - t0.getTime()) / 1000);
}

function valueAccessor(d) {
    if (d.value.total === null || d.value.count === 0) {
        return null;
    } else {
        return d.value.total / d.value.count;
    }
}

// Recalculate y range for values in filterRange.  Must re-render/redraw to
// update plot.
function recalculateY(chart, yDomain) {
    if (! chart) {
        return;
    }
    if (! yDomain) {
        if (chart.children !== undefined) {
            // Population series plot
            // key for dimension is [time, pop]
            var timeKey = function(element) {
                var parts = element.key.split("_");
                return new Date(+parts[0]);
            };
        } else {
            // Single line chart
            // key for dimension is time
            var timeKey = function(element) { return element.key; };
        }

        if (timeRange) {
            var valuesInRange = chart.group().all().filter(function(element, index, array) {
                return (timeKey(element) >= timeRange[0] && timeKey(element) < timeRange[1]);
            });
        } else {
            var valuesInRange = chart.group().all();
        }

        // If data has been filtered, some group elements may have no data, which would
        // cause minMaxY to always anchor at 0. Filter out those values here.
        var nonNull = valuesInRange.filter(function(d) {
            return valueAccessor(d) !== null;
        });
        var minMaxY = d3.extent(nonNull, function(d) {
            return valueAccessor(d);
        });
        // Make sure there is some distance within Y axis if all values are the same
        if (minMaxY[1] - minMaxY[0] === 0) {
            minMaxY[0] -= .1;
            minMaxY[1] += .1;
        }
        chart.y(d3.scale.linear().domain(minMaxY));
    } else {
        chart.y(d3.scale.linear().domain(yDomain));
    }
}

function getBinSize(dateRange) {
    var maxPoints = 480;

    // Find number of points for 3 minute buckets in timeRange
    var msIn3Min = 3 * 60 * 1000;
    var msInRange = dateRange[1].getTime() - dateRange[0].getTime();
    var points = ceiling(msInRange / msIn3Min);

    // Figure out how large to make each bin (in 480 3 minute point increments)
    // in order to keep points
    // below maxPoints. e.g. if there are 961 3 minute points in range,
    // then the new bin size would be 3 * 3 minutes = 9 minutes. If there
    // were 960 the new bin size would be 2 * 3 minutes = 6 minutes.
    return Math.min(ceiling(points / maxPoints), 8);
    //return 1;
}

function roundDate(date, firstDate, binSizeMilli) {
    var offset = Math.floor((date.getTime() - firstDate.getTime()) / binSizeMilli) * binSizeMilli;
    return new Date(firstDate.getTime() + offset);
}

function ceiling(input) {
    return Math.floor(input + .9999999);
}

function plot(jsonp) {
    var t0 = new Date().getTime();

    var data = transformData(jsonp);
    //console.log(jsonp, data);

    var t1 = new Date().getTime();

    // Make separate crossfilters for sfl data and range plot to prevent them
    // from filtering each other.
    sflxf = crossfilter(data["sfl"]);
    rangexf = crossfilter(data["range"]);
    popxf = crossfilter(data["pop"]);

    var msIn3Min = 3 * 60 * 1000;
    timeDims[1] = sflxf.dimension(function(d) { return d.time; });
    // Select the last day by default. If there is less than a day of data
    // select all data.
    timeRange = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
    timeRangeSizeMilli = timeRange[1].getTime() - timeRange[0].getTime();
    if (timeRangeSizeMilli >= 1000 * 60 * 60 * 24) {
        timeRange = [new Date(timeRange[1].getTime() - 1000 * 60 * 60 * 24), timeRange[1]];
    }
    var first = timeDims[1].bottom(1)[0].time;
    [2,3,4,5,6,7,8].forEach(function(binSize) {
        timeDims[binSize] = sflxf.dimension(function(d) {
            return roundDate(d.time, first, binSize*msIn3Min);
        });
    });

    ["velocity", "ocean_tmp", "salinity", "par"].forEach(function(key) {
        groups[key] = {};
        [1,2,3,4,5,6,7,8].forEach(function(binSize) {
            groups[key][binSize] = timeDims[binSize].group().reduce(
                reduceAdd(key), reduceRemove(key), reduceInitial);
        });
    });

    rangeDims[1] = rangexf.dimension(function(d) { return d.time; });
    [2,3,4,5,6,7,8].forEach(function(binSize) {
        rangeDims[binSize] = rangexf.dimension(function(d) {
            return roundDate(d.time, first, binSize*msIn3Min);
        });
    });

    (function(key) {
        groups.rangeChart = {};
        [1,2,3,4,5,6,7,8].forEach(function(binSize) {
            groups.rangeChart[binSize] = rangeDims[binSize].group().reduce(
                reduceAdd(key), reduceRemove(key), reduceInitial);
        });
    }("par"));

    timePopDims[1] = popxf.dimension(function(d) { return String(d.time.getTime()) + "_" + d.pop; });
    [2,3,4,5,6,7,8].forEach(function(binSize) {
        timePopDims[binSize] = popxf.dimension(function(d) {
            return String(roundDate(d.time, first, binSize*msIn3Min).getTime()) + "_" + d.pop;
        });
    });
    popDim = popxf.dimension(function(d) { return d.pop; });

    ["conc", "size"].forEach(function(key) {
        groups[key] = {};
        [1,2,3,4,5,6,7,8].forEach(function(binSize) {
            groups[key][binSize] = timePopDims[binSize].group().reduce(
                reduceAdd(key), reduceRemove(key), reduceInitial);
        });
    });

    var t2 = new Date().getTime();

    plotLineChart("velocity", "Speed (knots)");
    plotLineChart("ocean_tmp", "Temp (degC)");
    plotLineChart("salinity", "Salinity (psu)");

    plotPopSeriesChart("conc", "Abundance (10^6 cells/L)", legend = true);
    plotPopSeriesChart("size", "Forward scatter (a.u.)", legend = true);
    configureLegendButtons(charts["conc"]);
    configureLegendButtons(charts["size"]);

    plotRangeChart("PAR (w/m2)");
    charts.rangeChart.filter(timeRange);  // set default brush selection
    updateRangeChart();

    var query = "SELECT [time], attenuation, [type] ";
    query += "FROM [seaflow.viz@gmail.com].[SeaFlow: 3 minute attenuation typed] ";
    query += "WHERE [type] != 'mixed'"
    query += "ORDER BY [time] ASC";
    executeSqlQuery(query, function(jsonp) {
        var data = transformDataCSTAR(jsonp);

        cstarxf = crossfilter(data.cstar);

        var msIn3Min = 3 * 60 * 1000;
        cstarDims[1] = cstarxf.dimension(function(d) { return String(d.time.getTime()) + "_" + d.type; });
        var first = cstarDims[1].bottom(1)[0].time;
        [2,3,4,5,6,7,8].forEach(function(binSize) {
            cstarDims[binSize] = cstarxf.dimension(function(d) {
                return String(roundDate(d.time, first, binSize*msIn3Min).getTime()) + "_" + d.type;
            });
        });

        ["attenuation"].forEach(function(key) {
            groups[key] = {};
            [1,2,3,4,5,6,7,8].forEach(function(binSize) {
                groups[key][binSize] = cstarDims[binSize].group().reduce(
                    reduceAdd(key), reduceRemove(key), reduceInitial);
            });
        });

        plotCSTARSeriesChart("attenuation", "Attenuation (m-1)", legend = true);

        updateInterval = setInterval(update, REFRESH_TIME_MILLIS);

        updateLagText();
        lagTextInterval = setInterval(updateLagText, 1000 * 5);  // every 5 sec

        var t3 = new Date().getTime();

        /*console.log("transform time = " + ((t1 - t0) / 1000));
        console.log("crossfilter setup time = " + ((t2 - t1) / 1000));
        console.log("plot time = " + ((t3 - t2) / 1000));
        console.log("total time = " + ((t3 - t0) / 1000));*/
    });
}

// Needs to be called after chart with population legend is rendered.
// Rendering resets onclick handler for buttons.
function configureLegendButtons(chart) {
    if (! chart) {
        return;
    }
    var legendGroups = chart.selectAll("g.dc-legend-item");
    legendGroups[0].forEach(function(g) {
        var commonPopName = g.childNodes[1].firstChild.data;
        var popName = popLookup[commonPopName];
        g.onclick = function() {
            // Show / Hide population specific data
            popFlags[popName] = !popFlags[popName];
            filterPops();
            // Recalculate Y domain, reset onclick
            if (charts["conc"]) {
                recalculateY(charts["conc"]);
                charts["conc"].resetSvg();
                charts["conc"].render();
                configureLegendButtons(charts["conc"]);
            }
            if (charts["size"]) {
                recalculateY(charts["size"]);
                charts["size"].resetSvg();
                charts["size"].render();
                configureLegendButtons(charts["size"]);
            }
        };
    });
}

function filterPops() {
    popDim.filterAll();  // remove filters
    if (popFlags !== null) {
        popDim.filter(function(d) {
            return popFlags[d];
        });
    }
}

function updateLagText() {
    var lagMilli = new Date().getTime() - timeDims[1].top(1)[0].time.getTime();
    $("#update-lag").text(d3.format(".2f")(lagMilli / 1000 / 60) + " minutes since cruise contact");
}

function initialize() {
    // Create the map
    var mapOptions = {
        center : armbrustLab,
        panControl : true,
        streetViewControl : false,
        zoomControl : true,
        zoom : 8,
        mapTypeId : google.maps.MapTypeId.SATELLITE
    };
    map = new google.maps.Map(document.getElementById("map-canvas"), mapOptions);

    // Initialize ship tracks
    getNewShipTracks();

    var query = "SELECT * ";
    query += "FROM [seaflow.viz@gmail.com].[SeaFlow All Data] ";
    query += "ORDER BY [time] ASC";
    executeSqlQuery(query, plot);
}

function update() {
    if (timeDims[1] !== undefined) {

        var latestTime = timeDims[1].top(1)[0].time;
        var query = "SELECT * ";
        query += "FROM [seaflow.viz@gmail.com].[SeaFlow All Data] ";
        query += "WHERE [time] > '" + latestTime.toISOString() + "' ";
        query += "ORDER BY [time] ASC";
        executeSqlQuery(query, function(jsonp) {
            var data = transformData(jsonp);
            if (data.sfl.length) {
                console.log("Added " + data.sfl.length + " data points");
                sflxf.add(data.sfl);
                popxf.add(data.pop);
                rangexf.add(data.range);
                // Add one second to make sure we don't regrab the latest time point.
                // sqlshare by default returns a time string with 1 second precision,
                // but in the db the latest time will have some milliseconds as well
                // which which always return 1 data point below even if there was no new
                // data
                var latestCstar = new Date(cstarDims[1].top(1)[0].time.getTime() + 1000);
                var query = "SELECT [time], attenuation, [type] ";
                query += "FROM [seaflow.viz@gmail.com].[SeaFlow: 3 minute attenuation typed] ";
                query += "WHERE [time] > '" + latestCstar.toISOString() + "' ";
                query += "AND [type] != 'mixed' ";
                query += "ORDER BY [time] ASC";
                executeSqlQuery(query, function(jsonp) {
                    var data = transformDataCSTAR(jsonp);
                    if (data.cstar.length) {
                        console.log("Added " + data.cstar.length + " CSTAR data points");
                        cstarxf.add(data.cstar);
                    } else {
                        console.log("No new CSTAR data");
                    }
                    updateRangeChart();
                    updateCharts();
                    getNewShipTracks();
                });
            } else {
                console.log("No new data");
            }
        });
    }
}

infoBox = new InfoBox({
  alignBottom : true,
});

$('.gridly').gridly({gutter:4, base:60, columns:16, draggable: false});
google.maps.event.addDomListener(window, 'load', initialize);
