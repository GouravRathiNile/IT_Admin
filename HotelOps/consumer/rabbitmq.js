const amqp = require("amqplib");

let connection = null;
let channel = null;

const connectRabbitMQ = async () => {

    try {

        connection = await amqp.connect(process.env.RABBITMQ_URL);

        connection.on("close", () => {
            console.log("RabbitMQ Connection Closed");
            setTimeout(connectRabbitMQ, 5000);
        });

        connection.on("error", (err) => {
            console.log("RabbitMQ Error :", err.message);
        });

        channel = await connection.createChannel();

        console.log("Consumer RabbitMQ Connected");

        return channel;

    } catch (error) {

        console.log("RabbitMQ Connection Failed :", error.message);

        setTimeout(connectRabbitMQ, 5000);

    }

};

const getChannel = () => channel;

module.exports = {
    connectRabbitMQ,
    getChannel
};