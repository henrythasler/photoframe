import { LogLevels, Log } from "./helper";
import { AsyncMqttClient, connectAsync } from "async-mqtt";
// import { connect } from "mqtt";

export type DataSourceType = "mqtt";

export interface DataSource {
    name: string
    type: DataSourceType
    url: string
}

export interface Topic {
    [topic: string]: string;
}

export class Connection {
    protected log: Log;
    public brokerUrl: string;
    public client: AsyncMqttClient;
    public data: { [topic: string]: string };
    public topics: { [name: string]: string };

    constructor(brokerUrl: string, client: AsyncMqttClient, logLevel: number = LogLevels.INFO) {
        this.log = new Log(logLevel);
        this.brokerUrl = brokerUrl;
        this.client = client;
        this.data = {};
        this.topics = {};
    }
}

export class DataProvider {
    protected log: Log;
    protected connections: Connection[] = [];

    constructor(logLevel: number = LogLevels.INFO) {
        this.log = new Log(logLevel);
    }

    async init(dataSources: DataSource[]) {
        for (let i = 0; i < dataSources.length; i++) {
            let element = dataSources[i];

            const url = new URL(element.url);
            const newBrokerUrl = `${url.protocol}//${url.host}`;
            // this.log.show(`DataProvider.init(): Existing connections: ${JSON.stringify(this.connections)}`, LogLevels.TRACE);

            const connection = this.connections.find(({ brokerUrl }) => {
                return brokerUrl === newBrokerUrl
            });

            if (connection) {
                this.log.show(`DataProvider.init(): Broker '${connection.brokerUrl}' already known.`, LogLevels.TRACE);

                const newTopic = url.pathname.substr(1);
                connection.data[newTopic] = "-";
                connection.topics[element.name] = newTopic;

                this.log.show(`DataProvider.init(): Subscribing to ${newTopic}...`, LogLevels.TRACE);
                await connection.client.subscribe(connection.topics[element.name]);

                connection.client.on("message", (topic, payload) => this.onMessage(topic, payload, connection));
            }
            else {
                try {
                    this.log.show(`DataProvider.init(): New connection to ${newBrokerUrl}...`, LogLevels.TRACE);
                    const newClient = await connectAsync(newBrokerUrl);
                    const connection = new Connection(newBrokerUrl, newClient);
                    this.connections.push(connection);

                    const newTopic = url.pathname.substr(1);
                    connection.data[newTopic] = "-";
                    connection.topics[element.name] = newTopic;

                    this.log.show(`DataProvider.init(): Subscribing to ${newTopic}...`, LogLevels.TRACE);
                    await connection.client.subscribe(connection.topics[element.name]);

                    connection.client.on("message", (topic, payload) => this.onMessage(topic, payload, connection));

                } catch (error) {
                    this.log.show(`DataProvider.init(): ${error}`, LogLevels.ERROR);
                }
            }
        }
    }

    onMessage(topic: string, payload: Buffer, connection: Connection) {
        this.log.show(`DataProvider.onMessage() from ${connection.brokerUrl}: ${topic}, ${payload.toString()}`, LogLevels.TRACE);
        connection.data[topic] = payload.toString();
    }

    get(name: string, property?: string): string {
        let res = "?";
        // this.log.show(`DataProvider.init(): Existing connections: ${JSON.stringify(this.connections)}`, LogLevels.TRACE);
        const connection = this.connections.find(({ topics }) => {
            // this.log.show(`DataProvider.get(): checking ${JSON.stringify(topics)}`, LogLevels.TRACE);
            return topics[name]
        });

        if (connection) {

            if (property) {
                const topic = connection.topics[name];
                const json = JSON.parse(connection.data[topic]);
                if (json) {
                    res = json[property] ? json[property] : "!";
                }
            }
            else {
                const topic = connection.topics[name];
                res = connection.data[topic];
            }
            this.log.show(`DataProvider.get(): ${name}, ${res}`, LogLevels.TRACE);
        }
        else {
            this.log.show(`DataProvider.get(): ${name} not found`, LogLevels.TRACE);
        }
        return res;
    }
}