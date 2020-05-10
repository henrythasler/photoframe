import { LogLevels, Log } from "./helper";
import { AsyncMqttClient, connectAsync } from "async-mqtt";

export type DataSourceType = "mqtt";

export interface DataSource {
    name: string
    type: DataSourceType
    url: string
}

export interface Topic {
    [topic: string]: string;
}

export class DataProvider {
    protected log: Log;
    protected clients: AsyncMqttClient[] = [];
    protected data: { [topic: string]: string } = {};
    protected topics: { [name: string]: string } = {};

    constructor(logLevel: number = LogLevels.INFO) {
        this.log = new Log(logLevel);
    }

    async init(dataSources: DataSource[]) {
        dataSources.forEach(async (element) => {
            const brokerUrl = new URL(element.url).href;
            try {
                this.log.show(`DataProvider.init(): Connecting to ${brokerUrl}...`, LogLevels.TRACE);
                const client = await connectAsync("mqtt://omv4.fritz.box:1883");
                const topic = new URL(element.url).pathname.substr(1);
                this.log.show(`DataProvider.init(): Subscribing to ${topic}...`, LogLevels.TRACE);
                await client.subscribe(topic);
                client.on("message", (topic, payload) => this.onMessage(topic, payload));
                this.clients.push(client);
                this.data[topic] = "-";
                this.topics[element.name] = topic;
            } catch (error) {
                this.log.show(`DataProvider.init(): ${error}`, LogLevels.ERROR);
            }
        });
    }

    onMessage(topic: string, payload: Buffer) {
        this.log.show(`DataProvider.onMessage(): ${topic}, ${payload.toString()}`, LogLevels.TRACE);
        this.data[topic] = payload.toString();
    }

    get(name: string, property?: string): string {
        let res = "?";
        if (property) {
            const topic = this.topics[name];
            const json = JSON.parse(this.data[topic]);
            if (json) {
                res = json[property] ? json[property] : "!";
            }
        }
        else {
            const topic = this.topics[name];
            res = this.data[topic];
        }
        this.log.show(`DataProvider.get(): ${name}, ${res}`, LogLevels.TRACE);
        return res;
    }
}