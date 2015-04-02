var Promise = require('bluebird');
module.exports = simplify;

function simplify(channel) {
  if (channel.simplified) return channel;
  var get     = channel.get,
      consume = channel.consume,
      publish = channel.publish;

  channel.get = getMessage;
  channel.consume = consumeMessage;
  channel.publish = publishMessage;
  Object.defineProperty(channel, 'simplified', { value: true });

  // The `publish` and `sendToQueue` methods are special on a ConfirmChannel
  // instance as they are the only methods that only provide the callback style
  // API. See here: https://github.com/squaremo/amqp.node/pull/100
  //
  // These methods mimics the `stream.Writable` interface in its return value;
  // it will return `false` if the channel's write buffer is 'full', and true
  // otherwise. If it returns `false`, it will emit a 'drain' event at some
  // later time.
  //
  // The `writable.write(chunk[, encoding][, callback])` method:
  //
  //// This method writes some data to the underlying system, and calls the
  //// supplied callback once the data has been fully handled.
  ////
  //// The return value indicates if you should continue writing right now.
  //// If the data had to be buffered internally, then it will return `false`.
  //// Otherwise, it will return `true`.
  ////
  //// This return value is strictly advisory. You MAY continue to write,
  //// even if it returns `false`. However, writes will be buffered in memory,
  //// so it is best not to do this excessively. Instead, wait for the `drain`
  //// event before writing more data.
  //
  // This wrapper will modify the channel's `publish` and `sendToQueue` methods
  // to return a promise that contains one extra property: `ok`
  // 
  // This `ok` value is the result of the underlying `.write()` call and should
  // allow you to make intellegent flow control decisions.

  function publishMessage(exchange, key, content, options){
    // So we create two outer variables:
    // - ok (the boolean value of the underlying `.write()` call)
    // - write (the special promise we return)
    //
    // We do this because the value of `ok` is dependent on the result of
    // something happening inside the scope of the Promise initialization.
    // We need to hold onto this value until the promise has actually been
    // assigned to a variable so that we may assign the `ok` value to a
    // property on the `write` promise.
    var ok, write = new Promise(function(resolve, reject){

      // Serialize the passed message object
      var msg = new Buffer(JSON.stringify(content));

      // Simple promisification callback: rejects if there was an error,
      // otherwise it resolves.
      var callback = function(err){ return err ? reject(err) : resolve() };

      // Set the message's `contentType` option to JSON
      var opts = options || {};
      opts.contentType = 'application/json';

      // ** Here be dragons. **
      // This is probably too clever for its own good, but it's the magic
      // part where we set that outer `ok` variable to the result of the call
      // to the original `channel.publish()` (e.g. the underlying `.write()`)
      ok = publish.call(channel, exchange, key, msg, opts, callback);
    });

    // Finally we set the special `ok` property on the promise and return it.
    write.ok = ok;
    return write;
  }

  // This will modify the `consume` method so that the message callback supplied
  // in the second argument will itself be invoked with the following arguments
  // whenever a message is recieved:
  //
  // 1. The parsed JSON object
  // 2. The original message (You need this to `ack` and `nack` the message)
  function consumeMessage(queue, callback, options){
    var simplifiedCallback = parseMessageBefore(queue, callback, options);
    return consume.call(channel, queue, simplifiedCallback, options);
  }

  function getMessage(queue, options){
    return get.call(channel, queue, options).then(parseGetMessage);
  }

  function parseMessageBefore(queue, callback, options){
    return function onMessageParser(msg){
      // The message will be `null` if the consumer was cancelled by RabbitMQ
      if (msg === null) {
        channel.emit('cancelled', queue, callback, options);
      } else {
        callback.apply(null, parseMessage(msg));
      }
    };
  }

  return channel;
}

function parseGetMessage(get){
  return get === false
       ? [false, false]
       : parseMessage(get);
}

function parseMessage(message) {
  return [JSON.parse(message.content.toString()), message];
}
