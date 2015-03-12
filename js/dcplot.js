var data;
var charts = {};
// Short names for populations in database
var popNames = ["prochloro", "synecho", "picoeuk", "beads"];
// Full names for legend
var popLabels = ["Prochlorococcus", "Synechococcus", "Picoeukaryotes", "Beads"];
var popLookup = {"prochloro": "Prochlorococcus", "synecho": "Synechococcus", "picoeuk": "Picoeukaryotes", "beads": "Beads"};

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

    var sflValues = [];  // environmental data
    var popValues = [];  // population data

    var msecMinute = 60 * 1000;
    var prevTime = null;
    for (var i in jsonp.data) {
        var curTime = new Date(jsonp.data[i][idx["time"]]);

        // If this record is more than 4 minutes from last record, assume
        // records are missing and add a placeholder empty record. Only need 
        // one placeholder record per gap.  This placeholder record makes it
        // possible to draw line chart with gaps.
        /*if (i > 0 && (curTime - prevTime) > 4 * msecMinute) {
            sflValues.push({
                time: new Date(prevTime.getTime() + (3 * msecMinute)),
                salinity: null,
                ocean_tmp: null,
                par: null,
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
        }*/

        sflValues.push({
            time: curTime,
            ocean_tmp: jsonp.data[i][idx["ocean_tmp"]],
            salinity: jsonp.data[i][idx["salinity"]],
            par: jsonp.data[i][idx["par"]],
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

    return { sfl: sflValues, pop: popValues };
}

// Reduce functions to stop crossfilter from coercing null values to 0
// Allows chart.defined() to work as expected and create disconintinous
// line charts, while also differentiating between true 0 values and
// missing data.
function reduceAdd(key) {
    return function(p, v) {
        p.count++;
        p.total += v[key];
        return p;
    }
}

function reduceRemove(key) {
    return function(p, v) {
        p.count--;
        p.total -= v[key];
        return p;
    }
}

function reduceInitial() {
    return { count: 0, total: 0 };
}

// Only return group elements with counts > 0
function dummyGroup(sourceGroup) {
    return {
        all: function() {
            return sourceGroup.all().filter(function(d) {
                return d.value.count > 0;
            });
        }
    }
}

// Recalculate y range for values in filterRange.  Must re-render/redraw to
// update plot.
// TODO: consider doing this with additional dimensions.  Might be faster than
// traversing entire data set every time.
function recalculateY(chart) {
    var filter = chart.filter();
    if (chart.children !== undefined) {
        // Population series plot
        // key for dimension is [time, pop]
        var key = function(element) { return element.key[0]; };
    } else {
        // Single line chart
        // key for dimension is time
        var key = function(element) { return element.key; };
    }

    if (filter) {
        var valuesInRange = chart.group().all().filter(function(element, index, array) {
            return (key(element) >= filter[0] && key(element) < filter[1]);
        });
    } else {
        var valuesInRange = chart.group().all();
    }
    var minMaxY = d3.extent(valuesInRange, function(d) { return d.value.total; });
    // Add 10% headroom above and below
    var diff = minMaxY[1] - minMaxY[0];
    minMaxY[0] = minMaxY[0] - (diff * .1);
    minMaxY[1] = minMaxY[1] + (diff * .1);
    chart.y(d3.scale.linear().domain(minMaxY));
}

function preRedrawHandler(chart) {
    var filter = chart.filter();
    console.log("preRedraw fired");

    // Add dots if time range is small
    addDots(chart);

    // Recalculate Y domain
    recalculateY(chart);

    // Render
    // This may seem strange to do right before redrawing, but is necessary
    // to get dots drawn
    chart.render();
}

function filterByPop(popName, dim) {
    if (popName !== null) {
        dim.filter(popName);
    } else {
        dim.filterAll();
    }
    // Add dots if time range is small
    addDots(charts["conc"]);
    addDots(charts["size"]);

    // Recalculate Y domain
    recalculateY(charts["conc"]);
    recalculateY(charts["size"]);

    // Have to render and redraw to get dots drawn properly
    charts["conc"].render();
    charts["size"].render();
    charts["conc"].redraw();
    charts["size"].redraw();
}

function addDots(chart) {
    var filter = chart.filter();
    if (filter) {
        var maxDotRange = 1000 * 60 * 60 * 12 * 1;  // 12 hours
        var dotOptions = {
            radius: 2,
            fillOpacity: 0.8,
            strokeOpacity: 0.8
        };
        if ((filter[1] - filter[0]) <= maxDotRange) {
            console.log("Adding dots");
            if (chart.children !== undefined) {
                chart.children().forEach(function(c) {
                    c.renderDataPoints(dotOptions);
                });
            } else {
                chart.renderDataPoints(dotOptions);
            }
        } else {
            if (chart.children !== undefined) {
                chart.children().forEach(function(c) {
                    c.renderDataPoints(false);
                });
            } else {
                chart.renderDataPoints(false);
            }
        }
    }
}

function plotLineChart(timeDim, key, yAxisLabel) {
    var chart = dc.lineChart("#" + key);
    charts[key] = chart;

    var numberFormat = d3.format(".3n");

    var minMaxTime = [timeDim.bottom(1)[0].time, timeDim.top(1)[0].time];
    var keyGroup = dummyGroup(timeDim.group().reduce(
        reduceAdd(key), reduceRemove(key), reduceInitial));

    var minMaxY = d3.extent(keyGroup.all(), function(d) { return d.value.total; });

    chart
        .width(768)
        .height(100)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .brushOn(false)
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .dimension(timeDim)
        .group(keyGroup)
        .valueAccessor(function(d) { return d.value.total; })
        .defined(function(d) { return (d.y !== null); })  // don't plot segements with missing data
        .title(function(d) {
            return d.key + '\n' + d3.format(".3n")(d.value);
        })
        .on("preRedraw", preRedrawHandler);
    chart.render();
}

function plotSeriesChart(timeDim, timePopDim, key, yAxisLabel) {
    var chart = dc.seriesChart("#" + key);
    charts[key] = chart;

    var keyGroup = dummyGroup(timePopDim.group().reduce(
        reduceAdd(key), reduceRemove(key), reduceInitial));

    //var keyGroup = timePopDim.group().reduceSum(function(d) { return d[key]; });

    var minMaxTime = [timeDim.bottom(1)[0].time, timeDim.top(1)[0].time];
    var minMaxY = d3.extent(keyGroup.all(), function(p) { return p.value.total; });
    chart
        .width(768)
        .height(150)
        .chart(dc.lineChart)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .dimension(timePopDim)
        .group(keyGroup)
        .seriesAccessor(function(d) { return popLookup[d.key[1]]; })
        .keyAccessor(function(d) { return d.key[0]; })
        .valueAccessor(function(p) { return p.value.total; })
        .brushOn(false)
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .title(function(d) {
            return d.key[0] + '\n' + d.key[1] + "\n" + d3.format(".3n")(d.value.total);
        })
        .legend(dc.legend()
            .x(75)
            .y(100)
            .itemHeight(13)
            .gap(5)
            .horizontal(true)
            .autoItemWidth(true)
        )
        .childOptions({
            defined: function(d) {
                // don't plot segements with missing data
                return (d.y !== null);
            }
        })
        .on("preRedraw", preRedrawHandler);
    chart.margins().bottom = 20
    chart.render();
}

function plotRangeChart(timeDim, key, yAxisLabel) {
    var rangeChart = dc.lineChart("#rangeChart");
    charts["rangeChart"] = rangeChart;

    var minMaxTime = [timeDim.bottom(1)[0].time, timeDim.top(1)[0].time];
    var keyGroup = dummyGroup(timeDim.group().reduce(
            reduceAdd(key), reduceRemove(key), reduceInitial));
    var minMaxY = d3.extent(keyGroup.all(), function(d) { return d.value.total; });
    rangeChart
        .width(768)
        .height(100)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .dimension(timeDim)
        .group(keyGroup)
        .valueAccessor(function(d) { return d.value.total; })
        .defined(function(d) { return (d.y !== null); });  // don't plot segements with missing data
    rangeChart.render();
    rangeChart.on("filtered", function(chart, filter) {
        charts["ocean_tmp"].focus(filter);
        charts["salinity"].focus(filter);
        charts["par"].focus(filter);
        charts["conc"].focus(filter);
        charts["size"].focus(filter);
    });
}

function plot(jsonp) {
    var data = transformData(jsonp);

    var sflxf = crossfilter(data["sfl"]);
    var popxf = crossfilter(data["pop"]);

    var timeDim = sflxf.dimension(function(d) { return d.time; });
    var timePopDim = popxf.dimension(function(d) { return [d.time, d.pop]; });
    var popDim = popxf.dimension(function(d) { return d.pop; });

    plotLineChart(timeDim, "ocean_tmp", "Temp (degC)");
    plotLineChart(timeDim, "salinity", "Salinity (psu)");
    plotLineChart(timeDim, "par", "PAR (w/m2)");

    plotSeriesChart(timeDim, timePopDim, "conc", "Abundance (10^6 cells/L)");
    plotSeriesChart(timeDim, timePopDim, "size", "Forward scatter (a.u.)");

    plotRangeChart(timeDim, "total_conc", "Total Abundance (10^6 cells/L)");

    setTimeout(function() {
        //var first = charts["conc"].group().all().filter(function(d) { return d.key[1] === "beads"; })[0];
        //console.log(first.key[0], first.key[1], first.value.total, first.value.count);
        //console.log("filtering for prochloro");
        filterByPop("prochloro", popDim);
        //console.log(charts["conc"].group().all().filter(function(d) { return d.key[1] === "beads"; }));

        setTimeout(function() {
            console.log("Clearing filter");
            filterByPop(null, popDim);
            //console.log(charts["conc"].group().all().filter(function(d) { return d.key[1] === "beads"; }));
        }, 5000);

    }, 5000);
}

function initialize() {
    var query = 'SELECT *, (IsNull(prochloro_conc, 0) + IsNull(synecho_conc, 0) + IsNull(picoeuk_conc, 0) + IsNull(beads_conc, 0)) as total_conc ';
    query += 'FROM [seaflow.viz@gmail.com].[seaflow all query] ';
    query += 'ORDER BY [time] ASC';
    executeSqlQuery(query, plot);
}

initialize();
