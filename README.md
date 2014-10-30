# amqp.channel

Generalized way to get an AMQP connection/channel setup. It's a function that takes an AMQP url as the first parameter and an optional second parameter that defines which methods and arguments should be called on the `channel`. The function returns a `Promise` that will resolve with the [`channel` object](http://www.squaremobius.net/amqp.node/doc/channel_api.html) once all the method invocations defined in the second parameter have been resolved.

## Compared to `amqplib`

amqplib syntax:

```javascript
require('amqplib').connect(url).then(function(connection){
  return connection.createConfirmChannel();
}).then(function(channel){
  return require('bluebird').all([
    channel.assertExchange('exchange', 'fanout', { durable: true }),
    channel.checkExchange('exchange'),
    channel.bindExchange('alt.exchange', 'exchange', ''),
    channel.unbindExchange('alt.exchange', 'exchange', ''),
    channel.deleteExchange('alt.exchange', { ifEmpty: true }),
    channel.assertQueue('queue', { durable: true }),
    channel.checkQueue('queue'),
    channel.bindQueue('queue', 'exchange', ''),
    channel.unbindQueue('queue', 'exchange', ''),
    channel.purgeQueue('queue'),
    channel.deleteQueue('queue', { ifEmpty: true }),
    channel.prefetch(1)
  ]);
}).then(function(channel){
  // Do stuff with the channel
});
```

amqp.channel syntax:

```javascript
require('amqp.channel')(url, {
  assertExchange : [['exchange', 'fanout', { durable: true }]],
  checkExchange  : [['exchange']],
  bindExchange   : [['alt.exchange', 'exchange', '']],
  unbindExchange : [['alt.exchange', 'exchange', '']],
  deleteExchange : [['alt.exchange', { ifEmpty: true }]],
  assertQueue    : [['queue', { durable: true }]],
  checkQueue     : [['queue']],
  bindQueue      : [['queue', 'exchange', '']],
  unbindQueue    : [['queue', 'exchange', '']],
  purgeQueue     : [['queue']],
  deleteQueue    : [['queue', { ifEmpty: true }]],
  prefetch       : [[1]]
}).then(function(channel){
  // Do stuff with the channel
});
```

## Example

Say you wanted to listen to an exchange `'foo'` and send a different message to queue `'bar'` every time the message contained the word `'baz'`.

In your config.js:

```javascript
var env = process.env;
var cfg = {
  exchange: env.EXCHANGE_TO_BIND_TO || 'foo',
  queue: {
    toSendTo: env.QUEUE_TO_SEND_TO || 'bar',
    toConsumeFrom: env.QUEUE_TO_CONSUME_FROM  || 'baz',
  }
  amqpUrl: env.RABBIT_MQ_URL || 'amqp://test:test@192.168.2.2:5672'
};

module.exports = cfg;
```

In your app.js:

```javascript
var cfg = require('./config');
var amqp = require('amqp.channel');
var channelMethodsToCall = {
  // Channel method to invoke
  assertQueue: [ // Array of channel method invocations
    [ cfg.queue.toConsumeFrom ], // Arguments applied to the first invocation
    [ cfg.queue.toSendTo, { durable: true }] // Arguments applied to the second
  ],
  assertExchange: [
    [ cfg.exchange, 'fanout' ] // channel.assetExchange(cfg.exchange, 'fanout')
  ],
  bindQueue: [
    [ cfg.queue.toConsumeFrom, cfg.exchange, '' ]
  ]
};

module.exports = amqp(cfg.amqpUrl, channelMethodsToCall).then(consumeQueue);

function consumeQueue(channel){
  channel.consume(cfg.queue.toConsumeFrom, function onMessage(msg){
    if (msg === null) {
      channel.nack(msg);
      console.warn('RabbitMQ cancelled consumer');
    } else {
      channel.ack(msg);
      var message = msg.content.toString('utf8')
      if (/baz/.test(message)) {
        var msgToSend = new Buffer('qux');
        var options = { persistent: true };
        channel.sendToQueue(cfg.queue.toSendTo, msgToSend, options);
      }
    }
  });
  return channel;
}
```
