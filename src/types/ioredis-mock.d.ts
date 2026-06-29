declare module 'ioredis-mock' {
  import Redis from 'ioredis';

  const RedisMock: typeof Redis;
  export default RedisMock;
}
