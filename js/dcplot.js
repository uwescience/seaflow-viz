var data;
var charts = {};

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

// Turn jsonp data from SQL share query result into an array of JSON objects
// keyed by column header, with time converted to Date().getTime()
function transformData(jsonp) {
    if (jsonp.header.length < 2) {
        alert('Query ' + data.sql + ' returned ' + jsonp.header.length + ' columns, needs at least 2');
        return;
    }
    var values = [];
    var msecMinute = 60 * 1000;
    var prevTime = null;
    for (var i in jsonp.data) {
        var j = {}
        j.time = new Date(jsonp.data[i][0]);

        // If this record is more than 4 minutes from last record, assume
        // records are missing and add a placeholder empty record. Only need 
        // one placeholder record per gap.  This placeholder record makes it
        // possible to draw line chart with gaps.
        if (i > 0 && (j.time - prevTime) > 4 * msecMinute) {
            var placeholder = { time: new Date(prevTime.getTime() + (3 * msecMinute)) };
            for (var col = 0; col < jsonp.header.length - 1; ++col) {
                placeholder[jsonp.header[col+1]] = null;
            }
            placeholder["total_conc"] = null;
            values.push(placeholder);
        }

        for (var col = 0; col < jsonp.header.length - 1; ++col) {
            j[jsonp.header[col+1]] = jsonp.data[i][col+1];
        }
        j["total_conc"] = j["prochloro_conc"] + j["synecho_conc"] + j["picoeuk_conc"] + j["beads_conc"];
        values.push(j);
        prevTime = j.time;
    }
    return values;
}

// Reduce functions to stop crossfilter from coercing null values to 0
// Allows chart.defined() to work as expected and create disconintinous
// line charts
function reduceAdd(key) {
    return function(p, v) {
        if (p === null && v[key] === null) {
            return null;
        }
        return p + v[key];
    }
}

function reduceRemove(key) {
    return function(p, v) {
        if (p === null && v[key] === null) {
            return null;
        }
        return p - v[key];
    }
}

function reduceInitial() {
    return null;
}

// Recalculate y range for values in filterRange.  Must re-render/redraw to
// update plot.
// TODO: consider doing this with additional dimensions.  Might be faster than
// traversing entire data set every time.
function recalculateY(chart) {
    var filter = chart.filter();
    var valuesInRange = chart.group().all().filter(function(element, index, array) {
            return (element.key >= filter[0] && element.key < filter[1]);
        });
    var minMaxY = d3.extent(valuesInRange, function(d) { return d.value; });
    chart.y(d3.scale.linear().domain(minMaxY));
}

function plotTimeSeries(ndx, timeDim, key, yAxisLabel) {
    var chart = dc.lineChart("#" + key);
    charts[key] = chart;

    var numberFormat = d3.format(".3n");

    var minMaxTime = [timeDim.bottom(1)[0].time, timeDim.top(1)[0].time];
    var keyByTimeGroup = timeDim.group().reduce(
        reduceAdd(key), reduceRemove(key), reduceInitial);
    var minMaxY = d3.extent(keyByTimeGroup.all(), function(d) { return d.value; });

    chart
        .width(768)
        .height(100)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .brushOn(false)
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .renderHorizontalGridLines(true)
        .dimension(timeDim)
        .group(keyByTimeGroup)
        .defined(function(d) { return (d.y !== null); })  // don't plot segements with missing data
        .title(function(d) {
            return d.key + '\n' + d3.format(".3n")(d.value);
        })
        .on("filtered", function(chart, filter) {
            // Only draw dots if size of filter range is <= 12 hours
            var maxDotRange = 1000 * 60 * 60 * 12 * 1;  
            if ((filter[1] - filter[0]) <= maxDotRange) {
                chart.renderDataPoints({
                    radius: 2,
                    fillOpacity: 0.8,
                    strokeOpacity: 0.8
                });
            } else {
                chart.renderDataPoints(false);
            }

            // Recalculate Y domain
            //recalculateY(chart);

            // Have to render, not redraw, to fix all points in plot
            chart.render();
            //chart.redraw();
        });
    chart.render();
}

function plotPopulations(ndx, timeDim, key, yAxisLabel) {
    var chart = dc.compositeChart("#" + key);
    charts[key] = chart;

    var numberFormat = d3.format(".3n");

    var minMaxTime = [timeDim.bottom(1)[0].time, timeDim.top(1)[0].time];

    var groups = {};
    var minMaxY = [0, 0];
    var compose = [];
    var prefixes = ["prochloro", "synecho", "picoeuk", "beads"];
    var legendLabels = ["Prochlorococcus", "Synechococcus", "Picoeukaryotes", "Beads"];
    var colors = ["red", "green", "orange", "gray"];
    for (var i in prefixes) {
        var prefixKey = prefixes[i] + "_" + key;
        var group = timeDim.group().reduce(
            reduceAdd(prefixKey), reduceRemove(prefixKey), reduceInitial);
        var minMax = d3.extent(group.all(), function(d) { return d.value; });
        if (minMax[0] <= minMaxY[0]) {
            minMaxY = minMax[0];
        }
        if (minMax[1] > minMaxY[1]) {
            minMaxY[1] = minMax[1];
        }
        compose.push(
            dc.lineChart(chart)
                .dimension(timeDim)
                .group(group, legendLabels[i])
                .colors(colors[i])
        );
    }

    chart
        .width(768)
        .height(150)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .brushOn(false)
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .renderHorizontalGridLines(true)
        .dimension(timeDim)
        .title(function(d) {
            return d.key + '\n' + d3.format(".3n")(d.value);
        })
        .compose(compose)
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
        .on("filtered", function(chart, filter) {
            // Only draw dots if size of filter range is <= 12 hours
            var maxDotRange = 1000 * 60 * 60 * 12 * 1;
            if ((filter[1] - filter[0]) <= maxDotRange) {
                chart.children().forEach(function(c) {
                    c.renderDataPoints({
                        radius: 2,
                        fillOpacity: 0.8,
                        strokeOpacity: 0.8
                    });
                });
            } else {
                chart.children().forEach(function(c) {
                    c.renderDataPoints(false);
                });
            }

            // Recalculate Y domain
            //recalculateY(chart);

            // Have to render, not redraw, to fix all points in plot
            chart.render();
            //chart.redraw();
        });
    chart.margins().bottom = 20
    chart.render();
}

function plotRangeChart(ndx, timeDim) {
    var rangeChart = dc.lineChart("#rangeChart");
    charts["rangeChart"] = rangeChart;

    var minMaxTime = [timeDim.bottom(1)[0].time, timeDim.top(1)[0].time];
    var totalConcByTime = timeDim.group().reduce(
            reduceAdd("total_conc"), reduceRemove("total_conc"), reduceInitial);
    var minMaxY = d3.extent(totalConcByTime.all(), function(d) { return d.value; });
    rangeChart
        .width(768)
        .height(100)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .clipPadding(10)
        .yAxisLabel("Total Concentration")
        .dimension(timeDim)
        .group(totalConcByTime)
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
    var data = transformData(jsonp);  // array of JSON objects
    var ndx = crossfilter(data);
    var timeDim = ndx.dimension(function(d) { return d.time; });

    plotTimeSeries(ndx, timeDim, "ocean_tmp", "Temperature (C)");
    plotTimeSeries(ndx, timeDim, "salinity", "Salinity");
    plotTimeSeries(ndx, timeDim, "par", "PAR");
    plotPopulations(ndx, timeDim, "conc", "Concentration");
    plotPopulations(ndx, timeDim, "size", "Size (forward-scatter)");
    plotRangeChart(ndx, timeDim);
}

function initialize() {
    var query = 'SELECT * ';
    query += 'FROM [seaflow.viz@gmail.com].[seaflow all query] ';
    query += 'ORDER BY [time] ASC';
    executeSqlQuery(query, plot);
}

initialize()
