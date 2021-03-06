/*jslint nodejs: true, expr: true*/
/*global describe: true, it: true, before: true, after: true*/

process.env.NODE_ENV = 'test';

var _ = require('lodash'),
    sinon = require('sinon'),
    chai = require('chai'),
    Promise  = require('bluebird'),
    proxyquire  = require('proxyquire').noCallThru(),
    channel = new (require('events').EventEmitter)(),
    amqpUrl = 'amqp://test:test@192.168.2.2:5672',
    connection = {
      close: sinon.stub().returns(true),
      createConfirmChannel: function(){
        return Promise.resolve(channel);
      }
    },
    amqplib = {
      connect: function (url){
        return new Promise(function (resolve, reject){
          if (url === amqpUrl) {
            resolve(connection);
          } else {
            reject(new Error('Cannot connect to '+url));
          }
        });
      }
    },
    npmlog = {
      error: sinon.spy(),
      warn: sinon.spy(),
      info: sinon.spy()
    },
    connect = sinon.spy(amqplib, 'connect'),
    createConfirmChannel = sinon.spy(connection, 'createConfirmChannel');

channel.close = sinon.spy();
chai.use(require('chai-as-promised'));
chai.use(require('chai-things'));
chai.use(require('sinon-chai'));
var expect = chai.expect;

var assertions = {
  assertExchange : [['exchange', 'fanout', { durable: true }]],
  checkExchange  : [['exchange']],
  bindExchange   : [['alt.exchange', 'exchange', '']],
  unbindExchange : [['alt.exchange', 'exchange', '']],
  deleteExchange : [['exchange', { ifEmpty: true }]],
  assertQueue    : [['queue', { durable: true }]],
  checkQueue     : [['queue']],
  bindQueue      : [['queue', 'exchange', '']],
  unbindQueue    : [['queue', 'exchange', '']],
  purgeQueue     : [['queue']],
  deleteQueue    : [['queue', { ifEmpty: true }]]
};

function stubChannel(){
  var channel = proxyquire('../channel', {
    amqplib: amqplib
  });
  return arguments.length
    ? channel.apply(channel, arguments)
    : channel;
}

describe('Channel', function() {
  var getChannel = null;
  describe('with no assertions', function(){
    before(function(){
      return getChannel = stubChannel(amqpUrl);
    });

    it('should connect to the correct RabbitMQ URL', function(){
      expect(connect).to.have.been.calledOnce
        .and.to.have.been.calledWithExactly(amqpUrl, {});
    });

    it('should create a Channel on the Connection', function(){
      expect(createConfirmChannel).to.have.been.calledOnce
        .and.to.have.been.calledWithExactly();
    });

    it('should mark the Channel as blocked when it gets a blocked event', function(){
      channel.emit('blocked');
      expect(channel).to.have.property('isBlocked').that.is.true;
    });

    it('should mark the Channel as unblocked when it gets a blocked event', function(){
      channel.emit('unblocked');
      expect(channel).to.have.property('isBlocked').that.is.false;
    });

    it('should resolve with a Rabbit MQ Channel', function(){
      return expect(getChannel).to.eventually.eql(channel);
    });

    after(function(){
      connect.reset();
      createConfirmChannel.reset();
    });
  });

  describe('with valid assertions', function(){
    before(function(){
      _.merge(channel, _.mapValues(assertions, function(){
        return sinon.stub().returns(Promise.resolve());
      }));

      return getChannel = stubChannel(amqpUrl, assertions, npmlog);
    });

    it('should connect to the correct RabbitMQ URL', function(){
      expect(connect).to.have.been.calledOnce
        .and.to.have.been.calledWithExactly(amqpUrl, {});
    });

    it('should create a Channel on the Connection', function(){
      expect(createConfirmChannel).to.have.been.calledOnce
        .and.to.have.been.calledWithExactly();
    });

    it('should mark the Channel as blocked when it gets a blocked event', function(){
      channel.emit('blocked');
      expect(channel).to.have.property('isBlocked').that.is.true;
    });

    it('should mark the Channel as unblocked when it gets a blocked event', function(){
      channel.emit('unblocked');
      expect(channel).to.have.property('isBlocked').that.is.false;
    });

    it('should resolve with a Rabbit MQ Channel', function(){
      return expect(getChannel).to.eventually.eql(channel);
    });

    _.each(assertions, function(args, assertion){
      var verb = (function(){ switch (assertion[0]) {
        case 'a': return 'assert';
        case 'b': return 'bind  ';
        case 'c': return 'check ';
        case 'd': return 'delete';
        case 'p': return 'purge ';
        case 'u': return 'unbind';
      }})();
      var noun = assertion.replace(verb.trim(), '');
      var goal = verb + ' ' + noun + 's';
      it('should be able to ' + goal, function(){
        expect(channel).to.have.deep.property(assertion+'.args')
          .that.is.eql(args);
      });
    });

    after(function(){
      connect.reset();
      createConfirmChannel.reset();
    });
  });

  describe('with invalid assertions', function(){
    before(function (done){
      var test = done.bind(null, null);
      var methods = _.merge({ bogus : [['foo', 'bar']] }, assertions);
      getChannel = stubChannel(amqpUrl, methods, npmlog);
      getChannel.then(test, test);
    });

    it('should log an error', function(){
      expect(npmlog.error).to.have.been.calledOnce
        .and.have.deep.property('firstCall.args')
          .that.includes.something
            .that.is.an.instanceOf(TypeError);
    })

    it('should close the channel', function(){
      expect(channel.close).to.have.been.calledOnce
        .and.to.have.been.calledWithExactly();
    });

    it('should reject with an error', function(){
      expect(getChannel).to.be.rejectedWith(TypeError);
    });
    after(function(){
      connect.reset();
      createConfirmChannel.reset();
    });
  });

  describe('Simplified', function(){
    before(function(){
      return getChannel = stubChannel(amqpUrl, null, null);
    });

    function serialize(thing){
      return {
        content: new Buffer(JSON.stringify(thing)),
        fields: {},
        properties: { contentType: 'application/json' }
      };
    }

    function serializedMessage(msg){
      return sinon.match(function validateSerializedMessage(buffer){
        var parsed = JSON.parse(buffer.toString());
        return expect(parsed).to.eql(msg) || true;
      });
    }

    describe('#publish()', function(){
      var promise = {
        resolved: null,
        rejected: null
      };
      var msg = { hello: 'world' };
      var publish = sinon.stub();
      publish.onFirstCall().returns(false).callsArgWith(4, new Error('test'));
      publish.onSecondCall().returns(true).callsArgWith(4, null);
      channel.publish = publish;

      before(function(){
        var ch;
        return getChannel.then(function(c){ ch = c;
          return promise.rejected = ch.publish('exchange', 'routingKey', msg);
        }).catch(function(){
          return promise.resolved = ch.publish('exchange', 'routingKey', msg);
        });
      });

      it('should call the original #publish method', function(){
        expect(publish).to.have.been.calledTwice;
      });

      it('should serialize the passed message object into a Buffer', function(){
        expect(publish).and.to.have.been.calledWithExactly(
          'exchange',
          'routingKey',
          serializedMessage(msg),
          { contentType: 'application/json' },
          sinon.match.func
        );
      });

      it('should return a promise with extra `ok` property', function(){
        expect(promise.rejected).to.have.property('ok').that.is.false;
        expect(promise.rejected).to.be.rejectedWith(Error);
        expect(promise.resolved).to.have.property('ok').that.is.true;
        expect(promise.resolved).to.be.resolved;
      });
    });

    describe('#get()', function(){
      var get = sinon.stub();
      var msg = { hello: 'world', when: Date.now() };
      var serialized = serialize(msg);
      get.onFirstCall().returns(Promise.resolve(serialize(msg)));
      get.onSecondCall().returns(Promise.resolve(false));
      channel.get = get;

      before(function(){
        return getChannel;
      });

      // And this is how you get multiline test descriptions
      it('should be resolved with the parsed message and original', function(){
        return Promise.all([
          channel.get('queue', { noAck: true }).spread(function(parsed, orig){
            expect(parsed).to.eql(msg);
            expect(orig).to.eql(serialized);
          }),
          channel.get('queue').spread(function(parsed, orig){
            expect(parsed).to.be.false;
            expect(orig).to.be.false;
          })
        ]);
      });      
    });

    describe('#consume()', function(){
      var receiveMessage = null;
      var onCancelled = sinon.spy();
      channel.consume = sinon.spy(function(queue, callback){
        receiveMessage = callback;
      });
      channel.on('cancelled', onCancelled);

      before(function(){
        return getChannel;
      });

      // And this is how you get multiline test descriptions
      it('should be modified so that the callback supplied in the second', test());
      it('argument will itself be invoked with the parsed message object', test());
      it('and the original message whenever a message is recieved and', test());
      it('should emit a `cancelled` event on the channel with the parameters', test(true));
      it('passed to channel.consume() when a consumer gets cancelled', test(true));

      function test(cancelled){
        var consumer = sinon.spy();
        var msg = cancelled ? null : { hello: 'world', when: Date.now() };
        var testMsg = cancelled ? null : serialize(msg);
        return function(){
          channel.consume('queue', consumer, { noAck: true });
          receiveMessage(testMsg);
          if (cancelled) {
            expect(onCancelled).to.have.been.calledWithExactly(
              'queue',
              consumer,
              { noAck: true }
            );
          } else {
            expect(consumer).to.have.been.calledWithExactly(
              sinon.match(msg),
              testMsg
            );
          }
        }
      }
    });

    after(function(){
      connect.reset();
      createConfirmChannel.reset();
    });
  });
});
