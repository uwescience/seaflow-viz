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
var popDim;
var timeRange = null;
var sflxf;
var rangexf;
var popxf;
var labelFormat = d3.time.format.utc("%Y-%m-%d %H:%M:%S UTC");
var pinnedToMostRecent = false;  // should time selection be pinned to most recent data?
var legendChartKey = "size";  // key for chart which contains pop legend

var popFlags = {};
popNames.forEach(function(p) { popFlags[p] = true; });

function executeSqlQuery(query, cb) {
    var t0 = new Date();
    var sqlshare_query_url = 'https://rest.sqlshare.escience.washington.edu/REST.svc/execute?sql=';
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
            //console.log("SQL query took " + (((new Date().getTime()) - t0.getTime())/1000) + " sec")
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

    // Parse format returned from SQLShare as UTC
    var timeFormat = d3.time.format.utc("%m/%d/%Y %H:%M:%S %p");

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
    for (var i in jsonp.data.slice(0,460)) {
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
                par: null
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
            par: jsonp.data[i][idx["par"]]
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

    var minMaxTime = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
    var binSize = getBinSize(minMaxTime);
    var dim = timeDims[binSize];
    var group = groups[key][binSize];
    var minMaxY = d3.extent(group.all(), valueAccessor);

    chart
        .width(768)
        .height(100)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .brushOn(false)
        .clipPadding(10)
        .renderDataPoints({
            radius: 2,
            fillOpacity: 0.8,
            strokeOpacity: 0.8
        })
        .yAxisLabel(yAxisLabel)
        .interpolate("cardinal")
        .dimension(dim)
        .group(group)
        .valueAccessor(valueAccessor)
        .defined(function(d) { return (d.y !== null); })  // don't plot segements with missing data
        .title(function(d) {
            return labelFormat(d.key) + '\n' + d3.format(".3n")(valueAccessor(d)) + "\n" + d.value.total + "\n" + d.value.count;
        });
    chart.margins().bottom = 20;
    chart.margins().left = 60;
    chart.yAxis().ticks(6);
    chart.render();
}

function plotSeriesChart(key, yAxisLabel, legendFlag) {
    var chart = dc.seriesChart("#" + key);
    charts[key] = chart;

    var minMaxTime = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
    var binSize = getBinSize(minMaxTime);
    var dim = timePopDims[binSize];
    var group = groups[key][binSize];
    var minMaxY = d3.extent(group.all(), valueAccessor);

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
        .width(768)
        .height(200)
        .chart(dc.lineChart)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .dimension(dim)
        .group(group)
        .seriesAccessor(seriesAccessor)
        .keyAccessor(keyAccessor)
        .valueAccessor(valueAccessor)
        .brushOn(false)
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .title(function(d) {
            return labelFormat(keyAccessor(d)) + "\n" + d3.format(".3n")(valueAccessor(d)) + "\n" + d.value.total + "\n" + d.value.count;
        })
        .childOptions(
        {
            defined: function(d) {
                // don't plot segements with missing data
                return (d.y !== null);
            },
            interpolate: "cardinal",
            renderDataPoints: {
                radius: 2,
                fillOpacity: 0.8,
                strokeOpacity: 0.8
            }
        });
    chart.margins().bottom = 20;
    chart.margins().left = 60;
    chart.yAxis().ticks(6);

    // Legend setup
    if (legendFlag) {
        chart.legend(dc.legend()
            .x(175)
            .y(chart.height() - (2 * legendHeight) + Math.floor(legendHeight/2))
            .itemHeight(legendHeight)
            .gap(10)
            .horizontal(true)
            .autoItemWidth(true)
        );
        chart.margins().bottom += 2 * legendHeight;  // room for legend
    } else {
        // adjust chart size so that plot area is same size as chart with legend
        chart.height(chart.height() - 2 * legendHeight);
    }
    
    chart.render();
}

function plotRangeChart(yAxisLabel) {
    var chart = dc.lineChart("#rangeChart");
    charts["rangeChart"] = chart;

    var minMaxTime = [rangeDims[1].bottom(1)[0].time, rangeDims[1].top(1)[0].time];
    var binSize = getBinSize(minMaxTime);
    var dim = rangeDims[binSize];
    var group = groups.rangeChart[binSize];
    var minMaxY = d3.extent(group.all(), valueAccessor);

    chart
        .width(768)
        .height(100)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .interpolate("cardinal")
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
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
        }, 400);
    });
    chart.margins().bottom = 20;
    chart.margins().left = 60;
    chart.yAxis().ticks(6);
    chart.render();
}

function updateCharts() {
    var t0 = new Date();

    // No time window selected, reset timeRange to entire cruise
    if (charts.rangeChart.filter() === null) {
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
    // Reset population filters
    popDim.filterAll();
    
    ["ocean_tmp", "salinity", "par"].forEach(function(key) {
        if (charts[key] !== undefined) {
            charts[key].dimension(timeDims[binSize]);
            charts[key].group(groups[key][binSize]);
            charts[key].expireCache();
            charts[key].x().domain(timeRange);
            recalculateY(charts[key]);
            charts[key].render();
        }
    });

    ["conc", "size"].forEach(function(key) {
        if (charts[key] !== undefined) {
            charts[key].dimension(timePopDims[binSize]);
            charts[key].group(groups[key][binSize]);
            charts[key].expireCache();
            charts[key].x().domain(timeRange);
            recalculateY(charts[key]);

            // no need if filterPops is run right after. It will render too
            //charts[key].render();
        }
    });
    filterPops();

    // Need to reconfigure onclick for legend buttons after render
    configurePopButtons();

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
        var minMaxY = d3.extent(groups.rangeChart[rangeBinSize].all(), valueAccessor);
        charts.rangeChart.x().domain(totalTimeRange);
        charts.rangeChart.y().domain(minMaxY);
        // Also need to reset the brush extent to compensate for any potential
        // shifts in the X axis
        if (filter !== null) {
            charts.rangeChart.brush().extent(filter);
        }
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
function recalculateY(chart) {
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
}

function getBinSize(dateRange) {
    var maxPoints = 480;

    // Find number of points for 3 minute buckets in timeRange
    var msIn3Min = 3 * 60 * 1000;
    var msInRange = dateRange[1].getTime() - dateRange[0].getTime();
    var points = ceiling(msInRange / msIn3Min);

    // Figure out how large to make each bin (in ms) in order to keep points
    // below maxPoints. e.g. if there are 961 3 minute points in range,
    // then the new bin size would be 3 * 3 minutes = 9 minutes. If there
    // were 960 the new bin size would be 2 * 3 minutes = 6 minutes.
    return ceiling(points / maxPoints);
    //return 4;
}

function roundDate(date, firstDate, binSizeMilli) {
    var offset = Math.floor((date.getTime() - firstDate.getTime()) / binSizeMilli) * binSizeMilli;
    return new Date(firstDate.getTime() + offset);
}

function ceiling(input) {
    return Math.floor(input + .9999999);
}

function plot(jsonp) {
    dc.disableTransitions = true;
    var t0 = new Date().getTime();

    var data = transformData(jsonp);

    var t1 = new Date().getTime();

    // Make separate crossfilters for sfl data and range plot to prevent them
    // from filtering each other.
    sflxf = crossfilter(data["sfl"]);
    rangexf = crossfilter(data["range"]);
    popxf = crossfilter(data["pop"]);

    var msIn3Min = 3 * 60 * 1000;
    timeDims[1] = sflxf.dimension(function(d) { return d.time; });
    timeRange = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
    var first = timeDims[1].bottom(1)[0].time;
    timeDims[2] = sflxf.dimension(function(d) { return roundDate(d.time, first, 2*msIn3Min); });
    timeDims[3] = sflxf.dimension(function(d) { return roundDate(d.time, first, 3*msIn3Min); });
    timeDims[4] = sflxf.dimension(function(d) { return roundDate(d.time, first, 4*msIn3Min); });

    ["ocean_tmp", "salinity", "par"].forEach(function(key) {
        groups[key] = {};
        [1,2,3,4].forEach(function(binSize) {
            groups[key][binSize] = timeDims[binSize].group().reduce(
                reduceAdd(key), reduceRemove(key), reduceInitial);
        });
    });

    rangeDims[1] = rangexf.dimension(function(d) { return d.time; });
    rangeDims[2] = rangexf.dimension(function(d) { return roundDate(d.time, first, 2*msIn3Min); });
    rangeDims[3] = rangexf.dimension(function(d) { return roundDate(d.time, first, 3*msIn3Min); });
    rangeDims[4] = rangexf.dimension(function(d) { return roundDate(d.time, first, 4*msIn3Min); });

    (function(key) {
        groups.rangeChart = {};
        [1,2,3,4].forEach(function(binSize) {
            groups.rangeChart[binSize] = rangeDims[binSize].group().reduce(
                reduceAdd(key), reduceRemove(key), reduceInitial);
        });
    }("par"));

    timePopDims[1] = popxf.dimension(function(d) { return String(d.time.getTime()) + "_" + d.pop; });
    timePopDims[2] = popxf.dimension(function(d) { return String(roundDate(d.time, first, 2*msIn3Min).getTime()) + "_" + d.pop; });
    timePopDims[3] = popxf.dimension(function(d) { return String(roundDate(d.time, first, 3*msIn3Min).getTime()) + "_" + d.pop; });
    timePopDims[4] = popxf.dimension(function(d) { return String(roundDate(d.time, first, 4*msIn3Min).getTime()) + "_" + d.pop; });
    popDim = popxf.dimension(function(d) { return d.pop; });

    ["conc", "size"].forEach(function(key) {
        groups[key] = {};
        [1,2,3,4].forEach(function(binSize) {
            groups[key][binSize] = timePopDims[binSize].group().reduce(
                reduceAdd(key), reduceRemove(key), reduceInitial);
        });
    });

    var t2 = new Date().getTime();

    plotLineChart("ocean_tmp", "Temp (degC)");
    plotLineChart("salinity", "Salinity (psu)");
    plotLineChart("par", "PAR (w/m2)");

    plotSeriesChart("conc", "Abundance (10^6 cells/L)", legendChartKey === "conc");
    plotSeriesChart("size", "Forward scatter (a.u.)", legendChartKey === "size");
    configurePopButtons();

    plotRangeChart("PAR (w/m2)");

    var t3 = new Date().getTime();

    /*console.log("transform time = " + ((t1 - t0) / 1000));
    console.log("crossfilter setup time = " + ((t2 - t1) / 1000));
    console.log("plot time = " + ((t3 - t2) / 1000));
    console.log("total time = " + ((t3 - t0) / 1000));*/
}

// Needs to be called after chart with population legend is rendered.
// Rendering resets onclick handler for buttons.
function configurePopButtons() {
    var chart = charts[legendChartKey];
    var legendGroups = chart.selectAll("g.dc-legend-item");
    legendGroups[0].forEach(function(g) {
        var commonPopName = g.children[1].innerHTML;
        var popName = popLookup[commonPopName];
        g.onclick = function() {
            // Show / Hide population specific data
            popFlags[popName] = !popFlags[popName];
            filterPops();
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

    // Recalculate Y domain
    recalculateY(charts["conc"]);
    recalculateY(charts["size"]);

    // Have to render and redraw to get Y Axis scaling drawn properly
    charts["conc"].render();
    charts["size"].render();

    configurePopButtons();
}

function initialize() {
    var query = "SELECT *, (IsNull(prochloro_conc, 0) + IsNull(synecho_conc, 0) + IsNull(picoeuk_conc, 0) + IsNull(beads_conc, 0)) as total_conc ";
    query += "FROM [seaflow.viz@gmail.com].[seaflow all query] ";
    query += "WHERE [time] <= '12/12/2014 00:00:00 AM' ";
    query += "ORDER BY [time] ASC";
    executeSqlQuery(query, plot);

    //updateInterval = setInterval(update, 10000);
}

function update() {
    if (timeDims[1] !== undefined) {
        var latestTime = timeDims[1].top(1)[0].time;
        var tsqlFormat = d3.time.format.utc("%Y-%m-%d %H:%M:%S %p");
        var query = "SELECT TOP(1) *, (IsNull(prochloro_conc, 0) + IsNull(synecho_conc, 0) + IsNull(picoeuk_conc, 0) + IsNull(beads_conc, 0)) as total_conc ";
        query += "FROM [seaflow.viz@gmail.com].[seaflow all query] ";
        query += "WHERE [time] > '" + tsqlFormat(latestTime) + "' ";
        query += "ORDER BY [time] ASC";
        //clearInterval(updateInterval);
        executeSqlQuery(query, function(jsonp) {
            var data = transformData(jsonp);
            sflxf.add(data.sfl);
            popxf.add(data.pop);
            rangexf.add(data.range);
            updateRangeChart();
            updateCharts();
        });
    }
}

initialize();
update();

