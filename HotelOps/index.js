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
const BrandMasterRoutes = require("./routes/ITAdminRoutes/BrandMaster");
const OrganizationMasterRoutes = require("./routes/ITAdminRoutes/OrganizationRoutes");
const DivisionRoutes = require("./routes/ITAdminRoutes/DivisionRoutes");
const DepartmentRoutes = require("./routes/ITAdminRoutes/DepartmentRoutes");
const ProductCategoryRoutes = require("./routes/ITAdminRoutes/ProductCategoryRoutes");
const ProductRoutes = require("./routes/ITAdminRoutes/ProductRoutes");
const UserRoutes = require("./routes/ITAdminRoutes/UserRoutes");
const HotelOpsLoginRoutes = require("./routes/ITAdminRoutes/HotelOpsLoginRoutes");
const GuestGlitchRoutes = require("./routes/GuestGlitchRoutes/GuestGlitchRoutes");
const GuestMeetRoutes = require("./routes/GuestMeetRoute/GuestMeetRoute");
const IncidentReportRoutes = require("./routes/IncidentReportRoutes/IncidentReportRoutes");
const CapexRoutes = require("./routes/CapexRoute/CapexRoute");
const OpexRoutes = require("./routes/OpexRoute/OpexRoute");
const HLPReportRoutes = require("./routes/HLPReportRoutes/HLPReportRoutes");
const ReportRoutes = require("./routes/ReportRoutes/ReportRoutes");
const EngineeringRoutes = require("./routes/EngineeringRoutes/EngineeringRoutes");
// ==========================================Consumers
const BrandMasterConsumer = require("./consumer/ITAdminConsumer/BrandMaster");
const OrganizationHandler = require("./consumer/ITAdminConsumer/OrganizationHandler");
const DivisionHandler = require("./consumer/ITAdminConsumer/DivisionHandler");
const DepartmentHandler = require("./consumer/ITAdminConsumer/DepartmentHandler");
const ProductCategoryHandler = require("./consumer/ITAdminConsumer/ProductCategoryHandler");
const ProductHandler = require("./consumer/ITAdminConsumer/ProductHandler");
const UserHandler = require("./consumer/ITAdminConsumer/UserHandler");
const HotelOpsLoginHandler = require("./consumer/ITAdminConsumer/HotelOpsLoginHandler");
const GuestGlitchHandler = require("./consumer/GuestGlitchConsumer/GuestGlitchHandler");
const GuestMeetHandler = require("./consumer/GuestMeetConsumer/GuestMeetHandler");
const IncidentReportHandler = require("./consumer/IncidentReportConsumer/IncidentReportHandler");
const CapexHandler = require("./consumer/CapexConsumer/CapexHandler");
const OpexHandler = require("./consumer/OpexConsumer/OpexHandler");
const HLPReportHandler = require("./consumer/HLPReportConsumer/HLPReportHandler");
const ReportBuilderHandler = require("./consumer/ReportBuilderConsumer/ReportBuilderHandler");
const EngineeringHandler = require("./consumer/EngineeringConsumer/EngineeringHandler");
// ==========================================Packages Start
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
//======================================= Routes Url
app.use("/api/BrandMaster", BrandMasterRoutes);
app.use("/api/OrganizationMaster", OrganizationMasterRoutes);
app.use("/api/DivisionMaster", DivisionRoutes);
app.use("/api/DepartmentMaster", DepartmentRoutes);
app.use("/api/ProductCategoryMaster", ProductCategoryRoutes);
app.use("/api/ProductMaster", ProductRoutes);
app.use("/api/UserMaster", UserRoutes);
app.use("/api/HotelOpsLogin", HotelOpsLoginRoutes);
app.use("/api/GuestGlitch", GuestGlitchRoutes);
app.use("/api/GuestMeet", GuestMeetRoutes);
app.use("/api/IncidentReport", IncidentReportRoutes);
app.use("/api/Capex", CapexRoutes);
app.use("/api/Opex", OpexRoutes);
app.use("/api/HLPReport", HLPReportRoutes);
app.use("/api/Report", ReportRoutes);
app.use("/api/Engineering", EngineeringRoutes);
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
     // ===================================== Guest Glitch Consumer
    await startConsumer(
      QUEUE.GUEST_GLITCH.REQUEST,
      QUEUE.GUEST_GLITCH.RESPONSE,
      GuestGlitchHandler
    );
    // ===================================== Guest Meet Consumer
    await startConsumer(
      QUEUE.GUEST_MEET.REQUEST,
      QUEUE.GUEST_MEET.RESPONSE,
      GuestMeetHandler
    );
    // ===================================== Incident Report Consumer
    await startConsumer(
      QUEUE.INCIDENT_REPORT.REQUEST,
      QUEUE.INCIDENT_REPORT.RESPONSE,
      IncidentReportHandler
    );
    // ===================================== Capex Consumer
    await startConsumer(
      QUEUE.CAPEX.REQUEST,
      QUEUE.CAPEX.RESPONSE,
      CapexHandler
    );
    // ===================================== Opex Consumer
    await startConsumer(
      QUEUE.OPEX.REQUEST,
      QUEUE.OPEX.RESPONSE,
      OpexHandler
    );
    // ===================================== HLP Consumer
    await startConsumer(
      QUEUE.HLP_REPORT.REQUEST,
      QUEUE.HLP_REPORT.RESPONSE,
      HLPReportHandler
    );
    // ===================================== Report Builder Consumer
    await startConsumer(
      QUEUE.REPORT_BUILDER.REQUEST,
      QUEUE.REPORT_BUILDER.RESPONSE,
      ReportBuilderHandler
    );
     // =====================================  Engineering Consumer
    await startConsumer(
       QUEUE.ENGINEERING.REQUEST,
        QUEUE.ENGINEERING.RESPONSE,
      EngineeringHandler
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
