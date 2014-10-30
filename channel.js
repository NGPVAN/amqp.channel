var noop = function(){},
    Promise  = require('bluebird');

module.exports = function createChannel(url, assertions, log){
  assertions = assertions || {};
  log = log || { info: noop, warn: noop, error: noop };

  return require('amqplib').connect(url)
    .then(openChannel, log.error.bind(log, 'RabbitMQ'));

  function openChannel(connection) {
    var close = connection.close.bind(connection);
    log.info('RabbitMQ', 'Connected to %s', url);
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return connection.createConfirmChannel().then(assertChannel, close);
  }

  function assertChannel(channel) {
    var setup = [];
    for (var fn in assertions) {
      setup.push.apply(setup, assertions[fn].map(function invocation(args){
        log.info('RabbitMQ', 'Channel %s(%j)', fn, args);
        return channel[fn].apply(channel, args);
      }));
    };

    channel.on('error', log.error.bind(log, 'RabbitMQ'));
    channel.on('blocked', blocked(true));
    channel.on('unblocked', blocked(false));
    channel.isBlocked = false;

    return Promise.all(setup)
      .then(returnChannel)
      .catch(closeChannel);

    function returnChannel(){
      log.info('RabbitMQ', 'Channel assertions succeeded');
      return channel;
    }

    function closeChannel(error){
      log.error('RabbitMQ', 'Channel assertions failed', error);
      channel.close();
      throw error;
    }

    function blocked(isBlocked){
      return function changeState(){
        var state = isBlocked ? 'blocked' : 'unblocked';
        var level = isBlocked ? 'warn' : 'info';
        log[level]('RabbitMQ', 'Channel %s', state);
        channel.isBlocked = isBlocked;
      };
    }
  }
};
