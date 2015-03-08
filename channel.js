var noop = function(){},
    amqp = require('amqplib'),
    Promise = require('bluebird'),
    simplify = require('./simplify');

module.exports = function createChannel(url, assertions, log, makeSimple){
  assertions = assertions || {};
  log = log || { info: noop, warn: noop, error: noop };

  return amqp.connect(url).then(openChannel);

  function openChannel(connection) {
    var amqp = require('url').parse(url);
    var user = amqp.auth.split(':')[0];
    var close = connection.close.bind(connection);
    log.info('Connected to %s as "%s"', amqp.host, user);
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return connection.createConfirmChannel().then(setupChannel, close);
  }

  function setupChannel(channel) {
    var setup = [];
    for (var method in assertions) {
      setup.push.apply(setup, assertions[method].map(applyToChannel(method)));
    };

    channel.on('error', log.error);
    channel.on('blocked', blocked(true));
    channel.on('unblocked', blocked(false));
    channel.isBlocked = false;

    return Promise.all(setup).then(returnChannel, closeChannel);

    function applyToChannel(method){
      return function invocation(args){
        log.info('- Channel %s(%j)', method, args);
        return channel[method].apply(channel, args);
      }
    }

    function returnChannel(){
      log.info('- Channel setup complete');
      return makeSimple ? simplify(channel) : channel;
    }

    function closeChannel(error){
      log.error('- Channel assertions failed', error);
      channel.close();
      return Promise.reject(error);
    }

    function blocked(isBlocked){
      var state = isBlocked ? 'blocked' : 'unblocked';
      var level = isBlocked ? 'warn' : 'info';
      return function changeState(){
        log[level]('- Channel %s', state);
        channel.isBlocked = isBlocked;
      };
    }
  }
};
