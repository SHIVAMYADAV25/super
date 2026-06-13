require("dotenv/config");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

(async () => {
  const result = await pool.query("select now()");
  console.log(result.rows);
  await pool.end();
})();