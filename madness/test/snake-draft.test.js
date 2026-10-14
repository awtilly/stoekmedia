const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./_harness');

test('snakeOrder reverses direction every round', () => {
  const app = createApp();
  assert.deepEqual(app.snakeOrder(['a', 'b', 'c'], 6), ['a', 'b', 'c', 'c', 'b', 'a']);
  assert.deepEqual(app.snakeOrder(['a', 'b', 'c'], 9), ['a', 'b', 'c', 'c', 'b', 'a', 'a', 'b', 'c']);
});

test('snakeOrder truncates to the total pick count when teams do not divide evenly', () => {
  const app = createApp();
  const order = app.snakeOrder(['a', 'b', 'c', 'd'], 10);
  assert.equal(order.length, 10);
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'd', 'c', 'b', 'a', 'a', 'b']);
});

test('snakeOrder gives every player an equal share when total divides evenly', () => {
  const app = createApp();
  const pids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const order = app.snakeOrder(pids, 64);
  const counts = {};
  for (const id of order) counts[id] = (counts[id] || 0) + 1;
  for (const id of pids) assert.equal(counts[id], 8, id + ' should get 8 picks');
});

test('snakeOrder with a single player returns that player repeated', () => {
  const app = createApp();
  assert.deepEqual(app.snakeOrder(['solo'], 3), ['solo', 'solo', 'solo']);
});

test('snakeOrder with zero picks returns an empty order', () => {
  const app = createApp();
  assert.deepEqual(app.snakeOrder(['a', 'b'], 0), []);
});
