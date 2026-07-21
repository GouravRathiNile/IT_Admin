const { v4: uuidv4 } = require("uuid");
const { getChannel } = require("./rabbitmq");

const sendMessage = async (requestQueue, responseQueue, data) => {
    try {
        const channel = getChannel();

        if (!channel) {
            throw new Error("RabbitMQ Channel Not Initialized");
        }

        const correlationId = uuidv4();

        await channel.assertQueue(requestQueue, { durable: true });
        await channel.assertQueue(responseQueue, { durable: true });

        return new Promise((resolve, reject) => {

            const timeout = setTimeout(() => {
                reject(new Error("Response Timeout"));
            }, 30000);

            channel.consume(
                responseQueue,
                (msg) => {

                    if (
                        msg &&
                        msg.properties.correlationId === correlationId
                    ) {
                        clearTimeout(timeout);

                        const response = JSON.parse(msg.content.toString());
                         console.log("Enter  Received  Successfully=>", response);

                        channel.ack(msg);
                        resolve(response);
                    }
                },
                {
                    noAck: false
                }
            );
                 console.log('Enter Producer successfully')

            channel.sendToQueue(
                requestQueue,
                Buffer.from(JSON.stringify(data)),
                {
                    correlationId,
                    persistent: true
                }
            );

        });

    } catch (error) {
        throw error;
    }
};

module.exports = {
    sendMessage
};