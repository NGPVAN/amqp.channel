var noop = function(){},
    Promise  = require('bluebird');

module.exports = function createChannel(url, assertions, log){
  assertions = assertions || {};
  log = log || { info: noop, warn: noop, error: noop };

  return require('amqplib').connect(url).then(openChannel, log.error);

  function openChannel(connection) {
    var amqp = require('url').parse(url);
    var user = amqp.auth.split(':')[0];
    var close = connection.close.bind(connection);
    log.info('Connected to %s as "%s"', amqp.host, user);
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return connection.createConfirmChannel().then(assertChannelMethods, close);
  }

  function assertChannelMethods(channel) {
    var setup = [];
    for (var fn in assertions) {
      setup.push.apply(setup, assertions[fn].map(function invocation(args){
        log.info('- Channel %s(%j)', fn, args);
        return channel[fn].apply(channel, args);
      }));
    };

    channel.on('error', log.error);
    channel.on('blocked', blocked(true));
    channel.on('unblocked', blocked(false));
    channel.isBlocked = false;

    return Promise.all(setup)
      .then(returnChannel)
      .catch(closeChannel);

    function returnChannel(){
      log.info('- Channel setup complete');
      return channel;
    }

    function closeChannel(error){
      log.error('- Channel assertions failed', error);
      channel.close();
      throw error;
    }

    function blocked(isBlocked){
      return function changeState(){
        var state = isBlocked ? 'blocked' : 'unblocked';
        var level = isBlocked ? 'warn' : 'info';
        log[level]('- Channel %s', state);
        channel.isBlocked = isBlocked;
      };
    }
  }
};
