var fs = require('fs');
var path = require('path');
var stream = require('stream');
var util = require('util');

var debug = util.debuglog('fsobserve');

var FSObserver = (function(Super) {
  function FSObserver(patterns, accept) {
    Super.call(this, {
      objectMode: true,
    });

    this.threshold = 100;
    this.ignore = /^\.(.*)|\~$/;
    this.watchers = {};
  }

  FSObserver.prototype = Object.create(Super.prototype);
  FSObserver.prototype.constructor = FSObserver;

  FSObserver.prototype._read = function _read() {
    /* no-op */
  };

  FSObserver.prototype.add = function add(filename) {
    debug('observe', filename);

    var observer = this;
    fs.stat(filename, function(error, stats) {
      if (error) {
        return observer.emit('error', error);
      }

      var dirname = stats.isFile() ? path.dirname(filename) : filename;
      if (observer.watchers[dirname]) {
        return;
      }

      var watcher = fs.watch(dirname, {
        recursive: true,
      });

      observer.watchers[dirname] = watcher;

      var stats = {};
      process.nextTick(function() {
        fs.readdir(dirname, function(error, basenames) {
          if (error) {
            return observer.emit('error', error);
          }

          basenames.forEach(function(basename) {
            var filename = path.join(dirname, basename);

            fs.stat(filename, function(error, currentStats) {
              if (error) {
                return observer.emit('error', error);
              }

              stats[filename] = currentStats;
            });
          });
        });
      });

      var pending = {};
      watcher.on('change', function change(event, basename) {
        var filename = path.join(dirname, basename);
        if (basename.match(observer.ignore)) {
          return;
        }

        fs.stat(filename, function(error, currentStats) {
          var oldStats = stats[filename];

          if (oldStats === undefined && currentStats !== undefined) {
            debug('add', filename);

            observer.push({
              name: filename,
              type: 'delete',
              object: null,
            });

            stats[filename] = currentStats;
          }

          if (oldStats !== undefined && currentStats !== undefined) {
            if (!pending[filename]) {
              process.nextTick(function wait(previousStats) {
                fs.stat(filename, function(error, currentStats) {
                  if (error) {
                    return observer.emit('error', error);
                  }

                  var now = Date.now();
                  if (currentStats.size !== previousStats.size) {
                    pending[filename] = now;
                  }

                  if (now - pending[filename] >= observer.threshold) {
                    debug('update', filename);

                    observer.push({
                      name: filename,
                      type: 'update',
                      object: currentStats,
                      oldValue: oldStats,
                    }); 


                    stats[filename] = currentStats;
                    pending[filename] = false;
                  } else {
                    process.nextTick(wait, currentStats);
                  }
                });
              }, currentStats);
            }

            pending[filename] = Date.now();
          }

          if (oldStats !== undefined && currentStats == undefined) {
            debug('delete', filename);

            observer.push({
              name: filename,
              type: 'delete',
              object: null,
              oldValue: oldStats,
            });

            stats[filename] = currentStats;
          }
        });
      });

      watcher.on('error', function(error) {
        observer.emit('error', error);
      });
    });
  };

  FSObserver.prototype.destroy = function destroy() {
    Object.keys(this._watchers).forEach(function(key) {
      this._watchers[key].close();
      delete this._watchers[key];
    }, this);
  };

  return FSObserver;
}(stream.Readable));

function observe(patterns, options) {
  var observer = new FSObserver();
  return observer;
}

module.exports = observe;
