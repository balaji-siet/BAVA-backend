module.exports = {
  apps: [{
    name: 'smart-mess-backend',
    script: 'src/server.js',
    instances: 2,
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 5000,
      UV_THREADPOOL_SIZE: 16,
      MONGO_MAX_POOL_SIZE: 50
    }
  }]
};
