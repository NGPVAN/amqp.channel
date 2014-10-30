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
      close: sinon.spy(),
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

describe('Channel', function() {
  var getChannel = null;
  describe('with no assertions', function(){
    before(function(){
      getChannel = proxyquire('../channel', {
        amqplib: amqplib
      })(amqpUrl);
      return getChannel;
    });

    it('should connect to the correct RabbitMQ URL', function(){
      expect(connect).to.have.been.calledOnce;
      expect(connect).to.have.been.calledWithExactly(amqpUrl);
    });

    it('should create a Channel on the Connection', function(){
      expect(createConfirmChannel).to.have.been.calledOnce;
      expect(createConfirmChannel).to.have.been.calledWithExactly();
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

      getChannel = proxyquire('../channel', {
        amqplib: amqplib
      })(amqpUrl, assertions, npmlog);
      return getChannel;
    });

    it('should connect to the correct RabbitMQ URL', function(){
      expect(connect).to.have.been.calledOnce;
      expect(connect).to.have.been.calledWithExactly(amqpUrl);
    });

    it('should create a Channel on the Connection', function(){
      expect(createConfirmChannel).to.have.been.calledOnce;
      expect(createConfirmChannel).to.have.been.calledWithExactly();
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
      it('should be able to '+ verb +' '+ noun + 's', function(){
        expect(channel[assertion].args).to.eql(args);
      });
    });
  });

  describe('with invalid assertions', function(){
    before(function (done){
      var test = done.bind(null, null);
      channel.assertExchange = channel.assertQueue = 
        sinon.stub().returns(Promise.reject(new Error('Failure')));
      getChannel = proxyquire('../channel', {
        amqplib: amqplib
      })(amqpUrl, assertions, npmlog);
      getChannel.then(test).catch(test);
    });

    it('should log an error', function(){
      expect(npmlog.error).to.have.been.calledOnce;
      expect(npmlog.error.firstCall.args[1]).to.be.an.instanceOf(Error);
    })

    it('should close the channel', function(){
      expect(channel.close).to.have.been.calledOnce;
      expect(channel.close).to.have.been.calledWithExactly();
    });

    it('should reject with an error', function(){
      expect(getChannel).to.be.rejectedWith(Error);
    });
  });
});
