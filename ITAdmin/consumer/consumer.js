const { getChannel } = require("./rabbitmq");

const RETRY_DELAY_MS = 10000;
const RETRY_HEADER = "x-background-retry";

const startConsumer = async (
    requestQueue,
    responseQueue,
    callback
) => {

    const channel = getChannel();

    await channel.assertQueue(requestQueue, { durable: true });
    await channel.assertQueue(responseQueue, { durable: true });

    const retryQueue = `${requestQueue}_retry`;

    await channel.assertQueue(retryQueue, {
        durable: true,
        arguments: {
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": requestQueue,
            "x-message-ttl": RETRY_DELAY_MS
        }
    });

    console.log(`Listening : ${requestQueue}`);

    channel.consume(
        requestQueue,
        async (msg) => {

            try {

                const data = JSON.parse(msg.content.toString());

                const result = await callback(data);

                const isBackgroundRetry = Boolean(
                    msg.properties.headers?.[RETRY_HEADER]
                );

                if (result?.retry) {
                    if (!isBackgroundRetry) {
                        channel.sendToQueue(
                            responseQueue,
                            Buffer.from(JSON.stringify({
                                success: true,
                                queued: true,
                                saved: false,
                                message: "Data received successfully but is not saved yet. It will be saved automatically when the server is available."
                            })),
                            {
                                correlationId: msg.properties.correlationId,
                                persistent: true
                            }
                        );
                    }

                    channel.sendToQueue(
                        retryQueue,
                        msg.content,
                        {
                            persistent: true,
                            headers: {
                                ...msg.properties.headers,
                                [RETRY_HEADER]: true
                            }
                        }
                    );

                    channel.ack(msg);
                    return;
                }

                if (isBackgroundRetry) {
                    channel.ack(msg);
                    return;
                }

                channel.sendToQueue(
                    responseQueue,
                    Buffer.from(JSON.stringify(result)),
                    {
                        correlationId: msg.properties.correlationId,
                        persistent: true
                    }
                );

                channel.ack(msg);

            } catch (error) {

                console.log(error);

                channel.nack(msg);

            }

        },
        {
            noAck: false
        }
    );

};

module.exports = {
    startConsumer
};
