module.exports = {
  apps: [
    {
      name: "codexmc",
      script: "node",
      args: ".next/standalone/server.js",
      cwd: "/var/www/codexmc",  // change to your actual path
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
      env_file: ".env.local",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
