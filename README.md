# amqp.channel

Generalized way to get an AMQP connection/channel setup.

## Usage

In your config.js:

```javascript
var env = process.env;
var cfg = {
  foo: env.FOO_QUEUE,
  bar: env.BAR_QUEUE,
  exchange: env.EXCHANGE_NAME,
  exchangeType: env.EXCHANGE_TYPE,
  pattern: env.BIND_QUEUE_PATTERN,
  amqpUrl: env.RABBIT_MQ_URL
};

cfg.channel = {
  // Channel method to invoke
  assertQueue: [ // Array of channel method invocations
    [ cfg.foo ], // Arguments applied to the first method invocation
    [ cfg.bar, { durable: true } ]  // Arguments applied to the second
  ],
  assertExchange: [
    [ cfg.exchange, cfg.exchangeType ]
  ],
  bindQueue: [
    [ cfg.foo, cfg.exchange, cfg.pattern ]
  ]
};

module.exports = cfg;
```

In your app.js:

```javascript
var cfg = require('./config');
var amqp = require('amqp.channel');
amqp(cfg.amqpUrl, cfg.channel).then(function(channel){
  var msg = new Buffer('Hello World!');
  channel.sendToQueue(cfg.bar, msg);
  return channel;
}).then(function(channel){
  channel.consume(cfg.foo, function(msg){
    if (msg === null) {
      channel.nack(msg);
      console.warn('RabbitMQ cancelled consumer');
    } else {
      channel.ack(msg);
      console.log(msg.content.toString('utf8'));
    }
  });
});
```