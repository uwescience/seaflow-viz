
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

function plotTemp(ndx, divId, key) {

    executeSqlQuery(query, function (jsonp) {
        var data = transformData(jsonp);  // array of JSON objects
        var ndx = crossfilter(data);
        var tempDimension = ndx.dimension(function (d) { return [+d.time, d.ocean_tmp]; });
        var tempGroup = tempDimension.group().reduceSum(function (d) { return d.ocean_tmp });
        var chart = dc.scatterPlot(divId);
        charts[divId] = chart;
        chart
            .width(768)
            .height(100)
            .x(d3.time.scale.utc().domain(d3.extent(data, function (d) {return d.time})))
            .brushOn(true)
            .symbolSize(3)
            .clipPadding(10)
            .yAxisLabel("This is the Y Axis!")
            .dimension(tempDimension)
            .group(tempGroup);
        chart.render();
    });
}

function plotMorley() {

    var dataurl = "https://googledrive.com/host/0Bxt5Ia3JxzdHfl80ZGJQWEwxRk1YUlFhTVh4a1VlbFl6aTBkVmdIQ29EWmlIRkxpZEoyakE/morley.csv";
    d3.csv(dataurl, function(error, experiments) {
        console.log(experiments);
        experiments.forEach(function(x) {
            x.Speed = +x.Speed;
        });

        var ndx                 = crossfilter(experiments),
            runDimension        = ndx.dimension(function(d) {return [+d.Run, +d.Speed]; }),
            speedSumGroup       = runDimension.group().reduceSum(function(d) { return d.Speed; });
        var chart = dc.scatterPlot("#temp2");
        chart
            .width(768)
            .height(480)
            .x(d3.scale.linear().domain([6,20]))
            .brushOn(false)
            .symbolSize(8)
            .clipPadding(10)
            .yAxisLabel("This is the Y Axis!")
            .dimension(runDimension)
            .group(speedSumGroup);

        chart.render();
    });
}

function plotTest() {
    var data = [{'x': 1, 'y': 1}, {'x': 2, 'y': 2}, {'x': 3, 'y': 3}];
    var ndx = crossfilter(data);
    var xyDim = ndx.dimension(function (d) { return [+d.x, +d.y]; });
    var xyGroup = xyDim.group().reduceSum(function (d) { return d.y });
    var chart = dc.scatterPlot("#temp3");
    chart
        .width(768)
        .height(480)
        .x(d3.scale.linear().domain([1,2]))
        .brushOn(false)
        .symbolSize(8)
        .clipPadding(10)
        .dimension(xyDim)
        .group(xyGroup);

    chart.render();
}

// Turn jsonp data from SQL share query result into an array of JSON objects
// keyed by column header, with time converted to Date().getTime()
function transformData(jsonp) {
  if (jsonp.header.length < 2) {
    alert('Query ' + data.sql + ' returned ' + jsonp.header.length + ' columns, needs at least 2');
    return;
  }
  var values = [];
  // Construct the (x,y) tuples
  for (var i in jsonp.data) {
    var j = {}
    j.time = jsonp.data[i][0];
    if (j.time) {
        if (jsonp.type[0] == 'datetime') {
          j.time = new Date(j.time).getTime();
        }
        for (var col = 0; col < jsonp.header.length - 1; ++col) {
            if (jsonp.data[i][col+1] != null) {
                j[jsonp.header[col+1]] = jsonp.data[i][col+1];
            }
        }
        values.push(j);
      }
    }
  return values;
}

function plotTimeSeries(ndx, timeDim, key, yAxisLabel) {
    var chart = dc.lineChart("#" + key);
    charts[key] = chart;
    
    var numberFormat = d3.format(".3n");
    
    var minMaxTime = [timeDim.bottom(1)[0].time, timeDim.top(1)[0].time];
    var keyDim = ndx.dimension(function(d) { return d[key]; });
    var minMaxY = [keyDim.bottom(1)[0][key], keyDim.top(1)[0][key]];
    var keyByTimeGroup = timeDim.group().reduceSum(function(d) { return d[key]; });
    
    chart
        .width(768)
        .height(100)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxY))
        .brushOn(false)
        .clipPadding(10)
        .yAxisLabel(yAxisLabel)
        .dimension(timeDim)
        .group(keyByTimeGroup)
        .title(function(d) {
            return new Date(d.key) + '\n' + d3.format(".3n")(d.value);
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
            // Have to render, not redraw, to fix all points in plot
            chart.render();
        });
    chart.render();
}

function plot(jsonp) {
    var data = transformData(jsonp);  // array of JSON objects
    var ndx = crossfilter(data);

    var timeDim = ndx.dimension(function(d) { return d.time; });

    plotTimeSeries(ndx, timeDim, "ocean_tmp", "Temperature (C)");
    plotTimeSeries(ndx, timeDim, "salinity", "Salinity");
    plotTimeSeries(ndx, timeDim, "prochloro_conc", "Concentration");
    plotTimeSeries(ndx, timeDim, "prochloro_size", "Size");
    
    var rangeChart = dc.lineChart("#rangeChart");
    charts["rangeChart"] = rangeChart;

    var minMaxTime = [timeDim.bottom(1)[0].time, timeDim.top(1)[0].time];
    var concByTimeGroup = timeDim.group().reduceSum(function (d) { return d.prochloro_conc; });
    var concDim = ndx.dimension(function(d) { return d.prochloro_conc; });
    var minMaxConc = [concDim.bottom(1)[0].prochloro_conc, concDim.top(1)[0].prochloro_conc];

    rangeChart
        .width(768)
        .height(100)
        .x(d3.time.scale.utc().domain(minMaxTime))
        .y(d3.scale.linear().domain(minMaxConc))
        .clipPadding(10)
        .yAxisLabel("Concentration")
        .dimension(timeDim)
        .group(concByTimeGroup);
    rangeChart.render();
    rangeChart.on("filtered", function(chart, filter) {
        charts["ocean_tmp"].focus(filter);
        charts["salinity"].focus(filter);
        charts["prochloro_conc"].focus(filter);
        charts["prochloro_size"].focus(filter);
    });
}

function initialize() {
    var query = 'SELECT * ';
    query += 'FROM [seaflow.viz@gmail.com].[seaflow all query] ';
    query += 'ORDER BY [time] ASC';
    //logSqlQuery(query);
    executeSqlQuery(query, plot);
}

initialize()
