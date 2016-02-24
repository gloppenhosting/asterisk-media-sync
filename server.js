'use strict'

var domain = require('domain').create();
var os = require('os');
var moment = require('moment');
var config = require('config');
var mysql_config = config.get('mysql');
var asterisk_config = config.get('asterisk');
var md5 = require('md5');
var debug = process.env.NODE_DEBUG || config.get('debug') || true;
var fs = require('fs');
var mkdirp = require('mkdirp');

// On any errors. Write them to console and exit program with error code
domain.on('error', function (err) {
    if (debug) {
      console.log(moment(new Date()).format("YYYY-MM-DD HH:mm:ss"), err, err.stack);
    }

    process.exit(1);
});

// Encapsulate it all into a domain to catch all errors
domain.run(function () {

  var knex = require('knex')(
  {
    client: 'mysql2',
    connection: {
      host     : (process.env.MYSQL_HOST || mysql_config.get('host') || '127.0.0.1'),
      user     : (process.env.MYSQL_USER || mysql_config.get('user') || 'root'),
      password : (process.env.MYSQL_PASSWORD || mysql_config.get('password') || ''),
      database : (process.env.MYSQL_DB || mysql_config.get('database') || 'asterisk')
    },
    pool: {
        ping: function(connection, callback) {
            connection.query({sql: 'SELECT 1 = 1'}, [], callback);
        },
        pingTimeout: 3*1000,
        min: 1,
        max: 2
    }
  });

  var media_path = asterisk_config.get('media_path');

  // Create update function for update timer
  var update = function() {

    fs.readdir(media_path, function(err, files) {
      if (err) throw err;

      knex
      .select('md5', 'data', 'format')
      .from(asterisk_config.get('mediafilestable'))
      .then(function(rows) {

        rows.forEach(function (row) {
          var filename = row.md5 + '.' + row.format;
          var file_exists = files.indexOf(filename);

          if (file_exists > -1) {
            files.splice(file_exists, 1);
          }
          else {
            fs.writeFile(media_path + filename, row.data, function(err) {
              if (err) throw err;

              files.splice(file_exists, 1);
            });
          }
        });

        // Cleanup files not belonging anymore
        files.forEach(function (file) {
          fs.unlinkSync(media_path + file);
        });

      })
      .catch(function(err) {
        throw err;
      });
    });
  };

  // Create directory before we start!
  mkdirp(media_path, function(err) {
    // Lets update on first run!
    update();

    // Start timer
    var update_timer = setInterval(function() {
      update();
    },
      (config.get('update_interval_sec') * 1000)
    );
  });

});
