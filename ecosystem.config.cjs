module.exports = {
  apps: [
    {
      name: 'league-relay',
      script: 'dist/relay-server/index.js',
      cwd: './',
      env_file: '.env',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/relay-err.log',
      out_file: './logs/relay-out.log',
      log_file: './logs/relay-combined.log',
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log'],
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 8000,
      wait_ready: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};