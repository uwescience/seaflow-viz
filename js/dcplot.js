var charts = {};
// Short names for populations in database
var popNames = ["prochloro", "synecho", "picoeuk", "beads"];
// Full names for legend
var popLabels = ["Prochlorococcus", "Synechococcus", "Picoeukaryotes", "Beads"];
var groups = {};
var timeDims = {};
var rangeDims = {};
var timePopDims = {};
var popDim;
var timeFilter = null;

var popFlags = {};
popNames.forEach(function(p) { popFlags[p] = true; });

function executeSqlQuery(query, cb) {
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
            //console.log(jsonp);
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
        var curTime = new Date(jsonp.data[i][idx["time"]]);

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
                total_conc: null
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
            total_conc: jsonp.data[i][idx["total_conc"]]
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
        //console.log(p.count, p.total);
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

    if (timeFilter) {
        var valuesInRange = chart.group().all().filter(function(element, index, array) {
            return (timeKey(element) >= timeFilter[0] && timeKey(element) < timeFilter[1]);
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

// popFlags should be 
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
    //charts["conc"].render();
    //charts["size"].render();
    charts["conc"].render();
    charts["size"].render();
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
            return d.key + '\n' + d3.format(".3n")(valueAccessor(d)) + "\n" + d.value.total + "\n" + d.value.count;
        });
    chart.render();
}

function plotSeriesChart(key, yAxisLabel) {
    var popLookup = {"prochloro": "Prochlorococcus", "synecho": "Synechococcus", "picoeuk": "Picoeukaryotes", "beads": "Beads"};
    var chart = dc.seriesChart("#" + key);
    charts[key] = chart;

    var minMaxTime = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
    var binSize = getBinSize(minMaxTime);
    var dim = timePopDims[binSize];
    var group = groups[key][binSize];
    var minMaxY = d3.extent(group.all(), valueAccessor);

    var keyAccessor = function(d) {
        var parts = d.key.split("_");
        return new Date(+parts[0]);
    };
    var seriesAccessor = function(d) {
        return popLookup[d.key.split("_")[1]];
    };

    var minMaxY = d3.extent(group.all(), valueAccessor);

    chart
        .width(768)
        .height(150)
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
            return d.key + "\n" + d3.format(".3n")(valueAccessor(d)) + "\n" + d.value.total + "\n" + d.value.count;
        })
        .legend(dc.legend()
            .x(75)
            .y(100)
            .itemHeight(13)
            .gap(5)
            .horizontal(true)
            .autoItemWidth(true)
        )
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
    chart.margins().bottom = 20
    chart.render();
}

function plotRangeChart(key, yAxisLabel) {
    var rangeChart = dc.lineChart("#rangeChart");
    charts["rangeChart"] = rangeChart;

    var minMaxTime = [rangeDims[1].bottom(1)[0].time, rangeDims[1].top(1)[0].time];
    var binSize = getBinSize(minMaxTime);
    var dim = rangeDims[binSize];
    var group = groups[key][binSize];
    var minMaxY = d3.extent(group.all(), valueAccessor);

    rangeChart
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
    rangeChart.render();
    rangeChart.on("filtered", function(chart, filter) {
        dc.events.trigger(function() {
            var t0 = new Date();
            var binSize = getBinSize(filter);
            console.log(binSize);
            clearFilters();
            timeFilter = filter;
            if (filter === null) {
                filter = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
            }

            ["ocean_tmp", "salinity", "par"].forEach(function(key) {
                if (charts[key] !== undefined) {
                    //console.log("switching dim/group for " + key);
                    charts[key].dimension(timeDims[binSize]);
                    charts[key].group(groups[key][binSize]);
                    charts[key].x().domain([filter[0], filter[1]]);
                    recalculateY(charts[key]);
                    charts[key].render();
                }
            });

            ["conc", "size"].forEach(function(key) {
                if (charts[key] !== undefined) {
                    //console.log("switching dim/group for " + key);
                    charts[key].dimension(timePopDims[binSize]);
                    charts[key].group(groups[key][binSize]);
                    charts[key].x().domain([filter[0], filter[1]]);
                    recalculateY(charts[key]);

                    // no need if filterPops is run right after. It will render
                    // too.
                    //charts[key].render();
                }
            });
            filterPops();
            var t1 = new Date();
            console.log("filtered took " + (t1.getTime() - t0.getTime()) / 1000);
        }, 800);
    });
}

function clearFilters() {
    [1,2,3,4].forEach(function(binSize) {
        //timeDims[binSize].filterAll();
        timePopDims[binSize].filterAll();
    });
    popDim.filterAll();
}

function valueAccessor(d) {
    if (d.value.total === null || d.value.count === 0) {
        return null;
    } else {
        return d.value.total / d.value.count;
    }
}

function getBinSize(dateRange) {
    if (dateRange === null) {
        dateRange = [timeDims[1].bottom(1)[0].time, timeDims[1].top(1)[0].time];
    }
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
    //return 1;
}

function roundDate(date, firstDate, binSizeMilli) {
    var offset = Math.floor((date.getTime() - firstDate.getTime()) / binSizeMilli) * binSizeMilli;
    //if (binSize === 4) {console.log(date, firstDate, binSize, offset);}
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
    var sflxf = crossfilter(data["sfl"]),
        rangexf = crossfilter(data["range"]),
        popxf = crossfilter(data["pop"]);

    var msIn3Min = 3 * 60 * 1000;
    timeDims[1] = sflxf.dimension(function(d) { return d.time; });
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

    ["total_conc"].forEach(function(key) {
        groups[key] = {};
        [1,2,3,4].forEach(function(binSize) {
            groups[key][binSize] = rangeDims[binSize].group().reduce(
                reduceAdd(key), reduceRemove(key), reduceInitial);
        });
    });

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

    plotSeriesChart("conc", "Abundance (10^6 cells/L)");
    plotSeriesChart("size", "Forward scatter (a.u.)");

    plotRangeChart("total_conc", "Total Abundance (10^6 cells/L)");

    var t3 = new Date().getTime();

    console.log("transform time = " + ((t1 - t0) / 1000));
    console.log("crossfilter setup time = " + ((t2 - t1) / 1000));
    console.log("plot time = " + ((t3 - t2) / 1000));
    console.log("total time = " + ((t3 - t0) / 1000));
    // Set up basic population buttons
    popNames.forEach(function(pop) {
        makePopButton(pop);
    });
}

function makePopButton(popName) {
    var button = document.getElementById(popName + "Button");
    button.style.cursor = "pointer";
    button.onclick = function() {
        popFlags[popName] = !popFlags[popName];
        filterPops();
    };
}

function initialize() {
    var query = 'SELECT *, (IsNull(prochloro_conc, 0) + IsNull(synecho_conc, 0) + IsNull(picoeuk_conc, 0) + IsNull(beads_conc, 0)) as total_conc ';
    query += 'FROM [seaflow.viz@gmail.com].[seaflow all query] ';
    query += 'ORDER BY [time] ASC';
    executeSqlQuery(query, plot);
}

initialize();
