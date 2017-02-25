'use strict'

var domain = require('domain').create();
var os = require('os');
var moment = require('moment');
var config = require('config');
var mysql_config = config.get('mysql');
var asterisk_config = config.get('asterisk');
var md5 = require('md5');
var debug = true;
var fs = require('fs');
var mkdirp = require('mkdirp');
var heartBeatInterval = null;

// On any errors. Write them to console and exit program with error code
domain.on('error', function(err) {
    if (debug) {
        console.log(moment(new Date()).format("YYYY-MM-DD HH:mm:ss"), err, err.stack);
    }

    process.exit(1);
});

// Encapsulate it all into a domain to catch all errors
domain.run(function() {

    var knex = require('knex')({
        client: 'mysql',
        connection: {
            host: (process.env.MYSQL_HOST || mysql_config.get('host') || '127.0.0.1'),
            user: (process.env.MYSQL_USER || mysql_config.get('user') || 'root'),
            password: (process.env.MYSQL_PASSWORD || mysql_config.get('password') || ''),
            database: (process.env.MYSQL_DB || mysql_config.get('database') || 'asterisk')
        },
        pool: {
            ping: function(connection, callback) {
                connection.query({
                    sql: 'SELECT 1 = 1'
                }, [], callback);
            },
            pingTimeout: 3 * 1000,
            min: 1,
            max: 2
        }
    });

    if (heartBeatInterval) {
        clearInterval(heartBeatInterval)
        heartBeatInterval = null;
    }

    heartBeatInterval = setInterval(function() {
        knex.raw('SELECT 1=1')
            .then(function() {
                //  log.info('heartbeat sent');
            })
            .catch(function(err) {
                console.error('Knex heartbeat error, shutting down', err);
                process.exit(1);
            })
    }, 10000);

    var media_path = asterisk_config.get('media_path');

    // Create update function for update timer
    var update = function() {
        return new Promise((resolve, reject) => {

            fs.readdir(media_path, function(err, files) {
                if (err) throw err;

                var array = files.map(function(x) {
                    return x.replace(/\.sln/g, "")
                });

                knex
                    .select('md5', 'data', 'format')
                    .from(asterisk_config.get('mediafilestable'))
                    .whereNotIn('md5', array)
                    .limit(5)
                    .then(function(rows) {

                        rows.forEach(function(row) {
                            var filename = row.md5 + '.' + row.format;
                            var file_exists = files.indexOf(filename);

                            if (file_exists > -1) {
                                files.splice(file_exists, 1);
                            } else {
                                fs.writeFile(media_path + filename, row.data, function(err) {
                                    if (err) reject(err);

                                    console.log('Synced', filename, 'to path', media_path);
                                    files.splice(file_exists, 1);
                                });
                            }
                        });

                        resolve();
                    })
                    .catch(function(err) {
                        reject(err);
                    });
            });
        });
    };

    var start = function() {
        // Create directory before we start!
        mkdirp(media_path, function(err) {
            // Lets update on first run!
            update()
                .then(() => {
                    setTimeout(start, config.get('update_interval_sec') * 1000);
                })
                .catch((err) => {
                    console.error('An error occurred, exiting', err);
                    process.exit(1);
                });
        });
    }

    start();

});
