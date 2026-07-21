const { getChannel } = require("./rabbitmq");

const startConsumer = async (
    requestQueue,
    responseQueue,
    callback
) => {

    const channel = getChannel();

    await channel.assertQueue(requestQueue, { durable: true });
    await channel.assertQueue(responseQueue, { durable: true });

    console.log(`Listening : ${requestQueue}`);

    channel.consume(
        requestQueue,
        async (msg) => {

            try {

                const data = JSON.parse(msg.content.toString());

                const result = await callback(data);

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