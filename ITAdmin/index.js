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
const OrganizationMasterRoutes = require("./routes/OrganizationRoutes");
const DivisionRoutes = require("./routes/DivisionRoutes");
const DepartmentRoutes = require("./routes/DepartmentRoutes");
const ProductCategoryRoutes = require("./routes/ProductCategoryRoutes");
const ProductRoutes = require("./routes/ProductRoutes");
const UserRoutes = require("./routes/UserRoutes");
const HotelOpsLoginRoutes = require("./routes/HotelOpsLoginRoutes");
// ==========================================Consumers
const BrandMasterConsumer = require("./consumer/BrandMaster");
const OrganizationHandler = require("./consumer/OrganizationHandler");
const DivisionHandler = require("./consumer/DivisionHandler");
const DepartmentHandler = require("./consumer/DepartmentHandler");
const ProductCategoryHandler = require("./consumer/ProductCategoryHandler");
const ProductHandler = require("./consumer/ProductHandler");
const UserHandler = require("./consumer/UserHandler");
const HotelOpsLoginHandler = require("./consumer/HotelOpsLoginHandler");
// ==========================================Packages Start
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
//======================================= Routes Url
app.use("/api/brandmaster", BrandMasterRoutes);
app.use("/api/organizationmaster", OrganizationMasterRoutes);
app.use("/api/divisionmaster", DivisionRoutes);
app.use("/api/departmentmaster", DepartmentRoutes);
app.use("/api/productcategorymaster", ProductCategoryRoutes);
app.use("/api/productmaster", ProductRoutes);
app.use("/api/usermaster", UserRoutes);
app.use("/api/hotelopslogin", HotelOpsLoginRoutes);
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
    //==================================Brand Consumer
    await startConsumer(
      QUEUE.BRAND.REQUEST,
      QUEUE.BRAND.RESPONSE,
      BrandMasterConsumer,
    );
    //=====================================Organization Consumer
    await startConsumer(
      QUEUE.ORGANIZATION.REQUEST,
      QUEUE.ORGANIZATION.RESPONSE,
      OrganizationHandler,
    );
    //=====================================Division Consumer
    await startConsumer(
      QUEUE.DIVISION.REQUEST,
      QUEUE.DIVISION.RESPONSE,
      DivisionHandler,
    );
    //=====================================Department Consumer
    await startConsumer(
      QUEUE.DEPARTMENT.REQUEST,
      QUEUE.DEPARTMENT.RESPONSE,
      DepartmentHandler,
    );
    //=====================================Product Category Consumer
    await startConsumer(
      QUEUE.PRODUCT_CATEGORY.REQUEST,
      QUEUE.PRODUCT_CATEGORY.RESPONSE,
      ProductCategoryHandler,
    );
    //=====================================Product Master Consumer
    await startConsumer(
      QUEUE.PRODUCT.REQUEST,
      QUEUE.PRODUCT.RESPONSE,
      ProductHandler,
    );
    // ===================================== User Consumer
    await startConsumer(
      QUEUE.USER.REQUEST,
      QUEUE.USER.RESPONSE,
      UserHandler
    );
    // ======================================Login Consumer
    await startConsumer(
      QUEUE.AUTH.REQUEST,
      QUEUE.AUTH.RESPONSE,
      HotelOpsLoginHandler
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
