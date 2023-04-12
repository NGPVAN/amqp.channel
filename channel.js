var noop = function(){},
    util = require('util'),
    amqp = require('amqplib'),
    Promise = require('bluebird'),
    simplify = require('./simplify'),
    uriJs = require('uri-js');

module.exports = function createChannel(url, assertions, log, socketOptions, defaultServernameToHostname){
  assertions = assertions || {};
  log = log || { info: noop, warn: noop, error: noop };
  socketOptions = socketOptions || {};

  //SNI for TLS requires the servername be specified, see:
  //https://github.com/nodejs/node/issues/28167#issuecomment-500779815
  //https://github.com/squaremo/amqp.node/issues/331
  //This implements the default parsing everyone expects without breaking the api
  if (defaultServernameToHostname) {
    var host = uriJs.parse(url).host;
    socketOptions.servername = host;
  }

  function retryConnection(err) {
    console.log('AMQP channel error or disconnection, retrying', err);
    return new Promise(setTimeout(() => amqp.connect(url, socketOptions).then(openChannel), 60000));
}

  return amqp.connect(url, socketOptions).then(openChannel);

  function openChannel(connection) {
    var amqp = require('url').parse(url);
    var user = amqp.auth.split(':')[0];
    var close = function closeConnection(e){
      var close = Promise.resolve(connection.close());
      return e ? close.throw(e) : /* istanbul ignore next */ close;
    };
    console.log('Connected to %s as "%s"', amqp.host, user);
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    connection.once("close", retryConnection);
    connection.once("error", retryConnection);
    return connection.createConfirmChannel().then(setupChannel).catch(close);
  }

  function setupChannel(channel) {
    var setup = [], channelIsBlocked = false;
    for (var method in assertions) {
      if (typeof channel[method] === 'function') {
        setup.push.apply(setup, assertions[method].map(applyToChannel(method)));
      } else {
        return closeChannel(
          new TypeError(util.format('Channel has no method "%s"', method))
        );
      }
    };

    channel.on('error', log.error);
    channel.on('blocked', blocked(true));
    channel.on('unblocked', blocked(false));
    if (!channel.hasOwnProperty('isBlocked')) {
      Object.defineProperty(channel, 'isBlocked', {
        get: function(){ return channelIsBlocked },
        enumerable: true
      });
    }

    return Promise.all(setup).then(returnChannel, closeChannel);

    function applyToChannel(method){
      return function invocation(args){
        log.info('- Channel %s(%j)', method, args);
        return channel[method].apply(channel, args);
      }
    }

    function returnChannel(){
      log.info('- Channel setup complete');
      return simplify(channel);
    }

    function closeChannel(error){
      log.error('- Channel assertions failed', error);
      channel.close();
      return Promise.reject(error);
    }

    function blocked(isBlocked){
      var state = isBlocked ? 'blocked' : 'unblocked';
      var level = isBlocked ? 'warn' : 'info';
      return function changeBlockedState(){
        log[level]('- Channel %s', state);
        channelIsBlocked = isBlocked;
      };
    }
  }
};
