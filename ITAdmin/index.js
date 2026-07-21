//=============================================Packages
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
// ==========================================Db Connect function Import
const { connectDB } = require("./db");
// =========================================Producer RabbitMQ
const producerRabbit = require("./producer/rabbitmq");
// =========================================Consumer RabbitMQ
const consumerRabbit = require("./consumer/rabbitmq");
const { startConsumer } = require("./consumer/consumer");
//===========================================Queue
const QUEUE = require("./config/queue");
// ==========================================Routes
const BrandMasterRoutes = require("./routes/BrandMaster");
// ==========================================Consumers
const BrandMasterConsumer = require("./consumer/BrandMaster");
// ==========================================Packages Start
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
//======================================= Routes Url
app.use("/api/brandmaster", BrandMasterRoutes);
// =========================================Default Route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ITAdmin API Running...",
  });
});
// ========================================== Main Funcation
const startServer = async () => {
  try {
    // ====================================PostgreSQL Start
    await connectDB();
    // ====================================Producer RabbitMQ Start
    await producerRabbit.connectRabbitMQ();
    // ====================================Consumer RabbitMQ Start
    await consumerRabbit.connectRabbitMQ();
    await startConsumer(
      QUEUE.BRAND.REQUEST,
      QUEUE.BRAND.RESPONSE,
      BrandMasterConsumer,
    );
    //=====================================Port
    const PORT = process.env.PORT || 5000;
    //=====================================Project Start
    app.listen(PORT, () => {
      console.log(`🚀 Server Running On Port ${PORT}`);
    });
  } catch (error) {
    console.log(error);
  }
};

startServer();
