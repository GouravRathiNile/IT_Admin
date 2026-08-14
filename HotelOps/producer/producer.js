const { v4: uuidv4 } = require("uuid");
const { getChannel } = require("./rabbitmq");

const pendingRequests = new Map();
const responseConsumersByChannel = new WeakMap();

// Response Queue ko sirf ek baar consume karega
const startResponseConsumer = async (responseQueue) => {

    const channel = getChannel();

    if (!channel) {
        return;
    }

    let responseConsumers = responseConsumersByChannel.get(channel);
    if (!responseConsumers) {
        responseConsumers = new Set();
        responseConsumersByChannel.set(channel, responseConsumers);
    }

    if (responseConsumers.has(responseQueue)) {
        return;
    }

    responseConsumers.add(responseQueue);

    try {
        await channel.assertQueue(responseQueue, {
            durable: true
        });

        await channel.consume(
            responseQueue,
            (msg) => {

                if (!msg) return;

                const correlationId = msg.properties.correlationId;

                const pending = pendingRequests.get(correlationId);

                if (pending) {

                    const response = JSON.parse(msg.content.toString());

                    console.log("Producer Received =>", response);

                    clearTimeout(pending.timeout);

                    pending.resolve(response);

                    pendingRequests.delete(correlationId);

                }

                channel.ack(msg);

            },
            {
                noAck: false
            }
        );

        console.log(`Producer Response Consumer Started : ${responseQueue}`);
    } catch (error) {
        responseConsumers.delete(responseQueue);
        throw error;
    }
};

const sendMessage = async (
    requestQueue,
    responseQueue,
    data
) => {

    const channel = getChannel();

    if (!channel) {
        throw new Error("RabbitMQ Channel Not Initialized");
    }

    await channel.assertQueue(requestQueue, {
        durable: true
    });

    await startResponseConsumer(responseQueue);

    const correlationId = uuidv4();

    return new Promise((resolve, reject) => {

        const timeout = setTimeout(() => {

            pendingRequests.delete(correlationId);

            reject(new Error("Response Timeout"));

        }, 30000);

        pendingRequests.set(correlationId, {
            resolve,
            reject,
            timeout
        });

        // console.log("Producer Sending =>", data);

        channel.sendToQueue(

            requestQueue,

            Buffer.from(JSON.stringify(data)),

            {

                correlationId,

                persistent: true

            }

        );

    });

};

module.exports = {
    sendMessage
};
