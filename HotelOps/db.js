const { Pool } = require("pg");
require("dotenv").config();

const isLocal =
    process.env.DB_HOST === "localhost" ||
    process.env.DB_HOST === "127.0.0.1";
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    // ssl: {
    //     rejectUnauthorized: false
    // }
     ssl: isLocal
        ? false
        : {
              rejectUnauthorized: false
          }
});

const connectDB = async () => {
    try {

        const client = await pool.connect();

        console.log("✅ PostgreSQL Connected Successfully");

        client.release();

    } catch (error) {

        console.error("❌ Database Connection Failed:", error.message);

    }
};

module.exports = {
    pool,
    connectDB
};