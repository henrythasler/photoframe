import { PhotoFrame } from "./photoframe";

const frame = new PhotoFrame();

async function main() {
    // await frame.sendFile("/home/henry/screenshot.png");
    await frame.sendFile("/home/henry/Selection_201.png");
}

async function start() {
    frame.open().then((res) => {
        if (res === 0) {
            setInterval(main, 2000);
        }
        else {
            console.log(`Could not open device. Error ${res}`);

        }
    }).catch((err) => {
        console.log(`Error opening device. ${err}`);
    });
}

start();
