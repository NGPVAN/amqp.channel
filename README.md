# amqp.channel

[![Build Status][travis-image]][travis-url]
[![Test Coverage][coveralls-image]][coveralls-url]

A simplified way to setup an AMQP connection/channel with [amqplib](https://www.npmjs.org/package/amqplib). It's a function that takes an AMQP url as the first parameter and an optional second parameter that defines which methods and arguments should be called on the `channel`. The function returns a `Promise` that will resolve with the a `channel` object once all the method invocations defined in the second parameter have been resolved. Please see [amqplib's documentation for the `channel` API](http://www.squaremobius.net/amqp.node/doc/channel_api.html).

## Simplified Configuration

**amqplib syntax:**

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
    channel.assertQueue('first', { durable: true }),
    channel.assertQueue('second'),
    channel.checkQueue('first'),
    channel.bindQueue('first', 'exchange', ''),
    channel.unbindQueue('first', 'exchange', ''),
    channel.purgeQueue('first'),
    channel.deleteQueue('first', { ifEmpty: true }),
    channel.deleteQueue('second')
  ]);
}).then(function(channel){
  // Do stuff with the channel
});
```

**amqp.channel syntax:**

```javascript
require('amqp.channel')(url, {
  assertExchange : [['exchange', 'fanout', { durable: true }]],
  checkExchange  : [['exchange']],
  bindExchange   : [['alt.exchange', 'exchange', '']],
  unbindExchange : [['alt.exchange', 'exchange', '']],
  deleteExchange : [['alt.exchange', { ifEmpty: true }]],
  assertQueue    : [['first', { durable: true  }], ['second']],
  checkQueue     : [['first']],
  bindQueue      : [['first', 'exchange', '']],
  unbindQueue    : [['first', 'exchange', '']],
  purgeQueue     : [['first']],
  deleteQueue    : [['first', { ifEmpty: true }], ['second']]
}).then(function(channel){
  // Do stuff with the channel
});
```

## Simplified Usage

The `channel` object resolved by the returned `Promise` will behave differently from a normal `channel` object returned by the amqplib library in a few (hopefully convenient) ways:

1. The `consume`, `publish`, and `sendToQueue` channel methods have been changed to  explicitly handle JSON.
2. The `publish` and `sendToQueue` methods have been "promisified" in a way that will still provide information to know whether or not the write buffer is full (and therefore, whether or not you should continue writing to it) by adding an additional `ok` boolean property to the promise.

#### Examples of Modified Usage:

Automatic translation of JS object to JSON string to Buffer for sending/publishing:

```javascript
channel.sendToQueue('someQueue', { hello: 'world' });
channel.publish('someExchange', 'routingKey', { hello: 'world' });
```

Promisification of `sendToQueue` and `publish` methods:

```javascript
return channel.sendToQueue('someQueue', { hello: 'world' }).then(function(){
  return channel.publish('someExchange', 'routingKey', { hello: 'world' });
});
```

Automatic translation of message Buffer to JSON string to JS object for consuming:

```javascript
channel.sendToQueue('someQueue', { hello: 'world' });
channel.consume('someQueue', function(parsedMessage, originalMessage){
  console.log('hello', parsedMessage.hello); // => hello world
  channel.ack(originalMessage);
});
```

The `ok` property on the promises returned by the `sendToQueue` and `publish` methods:

```javascript
var sent = channel.sendToQueue('someQueue', { hello: 'world' });
if (sent.ok) {
  // continue sending
} else {
  // maybe pause sending until unblocked?
  channel.once('drain', function(){
    // continue sending
  });
}
```

## Real World Example

Say you wanted to listen to the `'foo'` exchange and send a different message to the `'bar'` queue every time the message's `baz` property contained the word `'qux'`.

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

cfg.channelMethodsToCall = {
  assertQueue: // Channel method to invoke
  [ // Array of channel method invocations
    [ // channel.assertQueue( cfg.queue.toConsumeFrom )
      cfg.queue.toConsumeFrom
    ],
    [ // channel.assertQueue( cfg.queue.toSendTo, { durable: true } );
      cfg.queue.toSendTo, { durable: true }
    ]
  ],
  assertExchange: [
    [ cfg.exchange, 'fanout' ] // channel.assetExchange(cfg.exchange, 'fanout')
  ],
  bindQueue: [
    [ cfg.queue.toConsumeFrom, cfg.exchange, '' ]
  ]
}

module.exports = cfg;
```

In your app.js:

```javascript
var cfg = require('./config');
var amqp = require('amqp.channel');

module.exports = amqp(cfg.amqpUrl, cfg.channelMethodsToCall)
  .then(consumeAtMost(1))
  .then(consumeFrom(cfg.queue.toConsumeFrom));
  
function consumeAtMost(maxMessages){
  return function(channel){
    // Only process `maxMessages` at a time and don't consume another
    // message until we've either `ack` or `nack` the current one.
    return channel.prefetch(maxMessage).then(function(){
      return channel;
    });
  }
}

function consumeFrom(queue){
  return function(channel){
    channel.consume(queue, function onMessage(parsed, msg){
      if (/baz/.test(parsed.baz)) {
        var msgToSend = { hello: 'world' };
        var options = { persistent: true };
        var sendMsg = channel.sendToQueue(cfg.queue.toSendTo, msgToSend, options);
        
        sendMsg.catch(function(e){
          console.error(e);
          // Try to process message again?
          // onMessage(parsed, msg);
        });
        
        if (sendMsg.ok) {
          channel.ack(msg);
        } else {
          sendMsg.then(function(){
            channel.ack(msg);
          });
        }
      } else {
        channel.ack(msg);
      }
    });
  
    channel.on('cancelled', function onConsumerCancelled(queue, cb, options){
      console.warn('RabbitMQ cancelled your consumer for %s', queue);
      // Try to setup the consumer again?
      // channel.consume(queue, cb, options);
    });
  
    return channel;
  }
}
```

[travis-image]: http://img.shields.io/travis/NGPVAN/amqp.channel.svg?style=flat-square
[travis-url]: https://travis-ci.org/NGPVAN/amqp.channel
[coveralls-image]: http://img.shields.io/coveralls/NGPVAN/amqp.channel.svg?style=flat-square
[coveralls-url]: https://coveralls.io/r/NGPVAN/amqp.channel?branch=master
