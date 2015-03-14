// Useful global variables
// .. the refresh time of the page
var REFRESH_TIME_MILLIS = 1 * 30 * 1000;
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
// The bounds of the known points in the map
var mapBounds = new google.maps.LatLngBounds();
// Whether the map has been zoomed yet
var hasZoomed = false;
// SQLShare REST server for queries
var sqlshare_query_url = 'https://rest.sqlshare.escience.washington.edu/REST.svc/execute?sql=';
// The log buffer
var logbuffer = '';

// Put the ship icon at the most recent location
function setupShipIcon(map) {
  console.log("setting ship at recent " + recentShipLocation);
  shipMarker.setMap(map);
  shipMarker.setPosition(recentShipLocation);
}

function zoomMapToBounds(map) {
map.fitBounds(mapBounds);
}

var infoBox = new InfoBox({
  alignBottom : true,
});

// Get the ship tracks
function initShipTracks(map) {
  console.log('initializing ship tracks');
  var query = 'WITH all_tracks AS (SELECT *, ROW_NUMBER() OVER (ORDER BY [time] ASC) AS row FROM [seaflow.viz@gmail.com].[SFL_VIEW]),\n';
  query += 'track_stats AS (SELECT COUNT(*) as num_tracks, CASE WHEN COUNT(*) < 1000 THEN 1 ELSE convert(int, (COUNT(*)+999)/1000) END AS granularity FROM all_tracks)\n';
  query += 'SELECT lat, lon\n';
  query += 'FROM all_tracks, track_stats\n';
  query += 'WHERE (num_tracks-row) % granularity = 0 AND (num_tracks - row) > 495\n';
  query += 'ORDER BY [time] ASC';
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
      tracks = jsonp['data'];
      if (tracks.length == 0) {
        console.log('no new track points');
        return;
      } else {
        console.log(tracks.length + ' new track points');
      }

      /*** Create a circle for every point ***/
      // .. the current point and timestamp
      var curPoint;
      var curTimestamp;
      // .. common options for every circle
      var circleOptions = {
        icon : {
          path : google.maps.SymbolPath.CIRCLE,
          fillColor : '#FFFFFF',
          fillOpacity : 0.5,
          strokeOpacity : 0,
          scale : 1.25,
          clickable : true
        }
      };
      // .. do the actual work
      for ( var index in tracks) {
        var curTrack = tracks[index];
        curPoint = new google.maps.LatLng(curTrack[0], curTrack[1]);
        circleOptions.position = curPoint;
        var circle = new google.maps.Marker(circleOptions);
        circle.setMap(map);
        google.maps.event.addListener(circle, 'mouseover', _makeMouseover(circle));

        /* Update map bounds */
        mapBounds.extend(curPoint);
      }

      addShipTracks(map);
    }
  });
}

// Get the ship tracks
function addShipTracks(map) {
  console.log('refreshing ship tracks since ' + recentShipTimestamp);
  var query = 'SELECT * FROM (SELECT TOP 500 lat, lon, [time]\n';
  query += 'FROM [seaflow.viz@gmail.com].[SFL_VIEW]\n';
  query += 'WHERE [time] > CAST(\'' + recentShipTimestamp.toISOString() + '\' AS datetime)';
  query += 'ORDER BY [time] DESC) x ORDER BY [time] ASC';
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
      tracks = jsonp['data'];
      if (tracks.length == 0) {
        console.log('no new track points');
        return;
      } else {
        console.log(tracks.length + ' new track points');
      }

      /*** Create a circle for every point ***/
      // .. the current point and timestamp
      var curPoint;
      var curTimestamp;
      // .. common options for every circle
      var circleOptions = {
        icon : {
          path : google.maps.SymbolPath.CIRCLE,
          fillColor : '#FF0000',
          fillOpacity : 1,
          strokeOpacity : 0,
          scale : 1.5,
          clickable : true
        }
      };
      // .. do the actual work
      for ( var index in tracks) {
        var curTrack = tracks[index];
        curPoint = new google.maps.LatLng(curTrack[0], curTrack[1]);
        curTimestamp = curTrack[2];
        circleOptions.position = curPoint;
        var circle = new google.maps.Marker(circleOptions);
        circle.setMap(map);
        google.maps.event.addListener(circle, 'mouseover', _makeMouseover(circle));

        /* Update map bounds */
        mapBounds.extend(curPoint);
      }

      // Save the most recent point
      console.log('timestamp = ' + curTimestamp);
      recentShipLocation = curPoint;
      recentShipTimestamp = new Date(curTimestamp);

      setupShipIcon(map);

      /* Re-zoom the map */
      zoomMapToBounds(map);
    }
  });
}

// (ugly?) Workarounds for Javascript scoping. Otherwise it always uses the last-created `circle` object.
function _makeMouseover(c) {
  return function() {
    infoBox.setContent('<div class="mapInfoWindow">' + c.getPosition().toUrlValue() + '</div>');
    infoBox.setPosition(c.getPosition());
    infoBox.open(c.getMap());
  }
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
  var map = new google.maps.Map(document.getElementById("map-canvas"), mapOptions);

  // Initialize ship tracks
  initShipTracks(map);

  // Refresh timer
  setInterval(function() {
    addShipTracks(map);
  }, REFRESH_TIME_MILLIS);

  makeDataPlots();
}

function transformData(data) {
  // Step 1: convert the data over to nvd3's format
  // .. Ensure that there are exactly 2 columns, X and Y
  if (data.header.length < 2) {
    alert('Query ' + data.sql + ' returned ' + data.header.length + ' columns, needs at least 2');
    return;
  }
  var values = [];
  // Construct the (x,y) tuples
  for ( var i in data.data) {
    var j = {}
    j.time = data.data[i][0];
    if (data.type[0] == 'datetime') {
      j.time = new Date(j.time).getTime();
    }
    for (var col = 0; col < data.header.length - 1; ++col) {
      j[data.header[col+1]] = data.data[i][col+1];
    }
    values.push(j);
  }
  console.log(values);
  return values;
}

var charts = {};  // keyed by svg element ID with #, e.g. temp-svg
function plotSqlData(data, svgName, optionalXLabel, optionalYLabel, subchart) {
  var values = transformData(data);
  if (subchart) {
    var chart = c3.generate({
      bindto: svgName,
      data: {
        json: values,
        keys: {
          x: 'time',
          value: [data.header[1]],
        },
        type: 'line'
      },
      axis: {
        x: {
            type: 'timeseries',
            tick: {
                format: '%Y-%m-%d',
                count: 10
            }
        }
      },
      transition: {
        duration: 0
      },
      subchart: {
        show: true,
        onbrush: function (domain) {
          charts["#all-sal-svg"].axis.range({
                min: {x: domain[0]},
                max: {x: domain[1]}
          });
        }
      }
    });
  } else {
    var chart = c3.generate({
      bindto: svgName,
      data: {
        json: values,
        keys: {
          x: 'time',
          value: [data.header[1]],
        },
        type: 'line'
      },
      axis: {
        x: {
            type: 'timeseries',
            tick: {
                format: '%Y-%m-%d',
                count: 10
            }
        }
      },
      transition: {
        duration: 0
      }
    });
  }
  console.log(svgName);
  console.log(chart);
  charts[svgName] = chart;
}

function plotSqlQuery(query, svgId, optionalXLabel, optionalYLabel, subchart) {
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
      console.log(jsonp);
      plotSqlData(jsonp, svgId, optionalXLabel, optionalYLabel, subchart);
    }
  });
}

//setInterval(updateChart, 1*60*1000);
function updateChart(svgName, startTime, endTime) {
console.log("Updating " + svgName);
var chart = charts[svgName];
chart.xDomain([startTime, endTime]);
chart.update();
chart.xAxis()
//d3.select(svgName).datum(datum).call(chart);
}
/*var updateTemp = setTimeout(function() {
var startTime = new Date("12/11/2014 1:33:09 AM").getTime();
var endTime = new Date().getTime("12/11/2014 1:48:10 AM");
updateChart("#all-temp-svg", startTime, endTime);
}, 1*15*1000);*/

function getPopConc() {
  var query = 'SELECT * FROM (SELECT TOP 500 * ';
  query += 'FROM [seaflow.viz@gmail.com].[SeaFlow: population-wise concentrations] ';
  query += 'ORDER BY [time] DESC) x ORDER BY [time] ASC';
  plotSqlQuery(query, '#pop-conc-svg', 'Time (GMT)', 'Abundance (10^6 cells/L)');
  var query = 'SELECT * FROM (SELECT TOP 500 * ';
  query += 'FROM [seaflow.viz@gmail.com].[SeaFlow: population-wise size (fsc_small)] ';
  query += 'ORDER BY [time] DESC) x ORDER BY [time] ASC';
  plotSqlQuery(query, '#pop-size-svg', 'Time (GMT)', 'Forward scatter (a.u.)');
}

function getAllTEMP() {
  var query = 'SELECT [time], ocean_tmp ';
  query += 'FROM [seaflow.viz@gmail.com].[seaflow all query] ';
  query += 'ORDER BY [time] ASC';
  plotSqlQuery(query, '#all-temp-svg','Date','Temperature (degC)', true);
}

function getTEMP() {
  var query = 'SELECT * ';
  query += 'FROM [seaflow.viz@gmail.com].[seaflow: Temp vs time] ';
  query += 'ORDER BY [time] ASC';
  plotSqlQuery(query, '#temp-svg','Time (GMT)', 'Temp (degC)');
}

function getSAL() {
  var query = 'SELECT * ';
  query += 'FROM [seaflow.viz@gmail.com].[seaflow: Salinity vs time] ';
  query += 'ORDER BY [time] ASC';
  plotSqlQuery(query, '#sal-svg','Time (GMT)', 'Salinity (psu)');
}

function getAllSAL() {
  var query = 'SELECT [time], salinity ';
  query += 'FROM [seaflow.viz@gmail.com].[seaflow all query] ';
  query += 'ORDER BY [time] ASC';
  plotSqlQuery(query, '#all-sal-svg','Date','Salinity (psu)', false);
}

function getPAR() {
  var query = 'SELECT * ';
  query += 'FROM [seaflow.viz@gmail.com].[seaflow: PAR vs time] ';
  query += 'ORDER BY [time] ASC';
  plotSqlQuery(query, '#par-svg','Time (GMT)', 'PAR (w/m2)');
}

function getVelocity() {
  var query = 'SELECT DateTime,  [Velocity (knots)] FROM (SELECT TOP 500 * ';
  query += 'FROM [seaflow.viz@gmail.com].[SeaFlow: velocity] ';
  query += 'WHERE [Velocity (knots)] IS NOT NULL ';
  query += 'ORDER BY [DateTime] DESC) x ORDER BY [DateTime] ASC';
  plotSqlQuery(query, '#velo-svg', 'Time (GMT)','Ship speed (knots)');
}

function makeDataPlots() {
  //getPAR();
  //getTEMP();
  getAllTEMP();
  getAllSAL();
  //getSAL();
  updateLastTimes();
  getVelocity();
  //getTempSal();
  //getPopConc();
}

//makeDataPlots();
//setInterval(makeDataPlots, REFRESH_TIME_MILLIS);

function updateLastTimes() {
  var query = 'SELECT DATEDIFF(minute, MAX([Time]), GETDATE()) AS Lag FROM [seaflow.viz@gmail.com].[stats_view]';
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
      elapsed = jsonp['data'];
      console.log(elapsed[0][0] + " minutes delay with ship data.");
      $("#stats_time").text(elapsed[0][0] + " minutes delay with ship data.");
    }
  });
}

$('.gridly').gridly({gutter:4, base:60, columns:16, draggable: false});
google.maps.event.addDomListener(window, 'load', initialize);

$(document).on("click", ".gridly .square", function(event) {
  var $this, size;
  event.preventDefault();
  event.stopPropagation();
  $this = $(this);
  $this.toggleClass('small');
  $this.toggleClass('large');

  var svg_name = $this.attr('data-svg');
  charts['#' + svg_name].update();
  var ret = $('.gridly').gridly('layout');
  document.getElementById(svg_name).scrollIntoView();
  return ret;
});
