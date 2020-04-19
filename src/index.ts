import { readFileSync } from "fs";
import { parse } from "@iarna/toml";

import { PhotoFrame } from "./photoframe";
import { ImageGenerator, Config, Screen } from "./generator";

let renderIndex = 0;
let showIndex = 0;

interface SlideshowItem {
    image: Buffer | null,
    renderTimestamp: number,
    showTimestamp: number,
    refreshSeconds: number
    showSeconds: number
}

let slideshowItems: SlideshowItem[] = [];

const frame = new PhotoFrame();

async function render() {
    if (frame.screenAvailable()) {
        let item = slideshowItems[renderIndex];

        if((item.renderTimestamp + item.refreshSeconds*1000) < Date.now()) {
            item.image = await generator.renderScreen(renderIndex);
            item.renderTimestamp = Date.now();
        }
        else {
            // console.log(`idling...`)
        }
        // if (images[i].image) {
        //     await frame.displayImage(images[i].image);
        // }
        renderIndex = (renderIndex + 1) % slideshowItems.length;
    }
    else {
        renderIndex = 0;
        // console.log(`sleeping...`)
    }
    setTimeout(render, 1000);
}

async function show() {
    let item = slideshowItems[showIndex];
    if (frame.screenAvailable()) {

        if (item.image) {
            await frame.displayImage(item.image);
        }

        showIndex = (showIndex + 1) % slideshowItems.length;
    }
    else {
        showIndex = 0;
        // console.log(`sleeping...`)
    }
    setTimeout(show, 5000);
}


const config = parse(readFileSync("config/test.toml", "utf8")) as unknown as Config;

config.screen.map((item) => {
    slideshowItems.push({
        image: null,
        renderTimestamp: 0,
        refreshSeconds: item.refreshSeconds?item.refreshSeconds:600,
        showTimestamp: 0,
        showSeconds: item.showSeconds?item.showSeconds:10,
    })
})

const generator = new ImageGenerator(config);

frame.checkDevices();
frame.registerCallbacks();
setTimeout(render, 1000);
setTimeout(show, 2000);
