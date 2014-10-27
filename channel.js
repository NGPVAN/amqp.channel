var log      = require('npmlog'),
    Promise  = require('bluebird');

module.exports = function createChannel(url, assertions){
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
      setup.push.apply(setup, assertions[fn].map(function(args){
        return channel[fn].apply(channel, args);
      }));
    };

    channel.on('error', error);
    channel.on('blocked', blocked);
    channel.on('unblocked', unblocked);
    channel.isBlocked = false;

    return Promise.all(setup)
      .then(returnChannel)
      .catch(closeChannel);

    function returnChannel(){
      log.info('RabbitMQ', 'Channel assertions succeeded');
      return channel;
    }

    function closeChannel(err){
      log.error('RabbitMQ', 'Channel assertions failed', err);
      channel.close();
      throw error;
    }

    function error(err){
      log.error('RabbitMQ', err);
    }

    function blocked(){
      log.warn('RabbitMQ', 'Channel blocked');
      channel.isBlocked = true;
    }

    function unblocked(){
      log.info('RabbitMQ', 'Channel unblocked');
      channel.isBlocked = false;
    }
  }
};
