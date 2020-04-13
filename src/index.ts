import { PhotoFrame } from "./photoframe";

const frame = new PhotoFrame();

const files = ["/home/henry/tegelberg.jpg", "/home/henry/screenshot.png", "/home/henry/schlegeis.jpg", "/home/henry/Selection_201.png"]
let i = 0;

async function main() {
    const filename = files[(i++)%files.length];
    console.log("\n"+filename)
    await frame.sendFile(filename);
    setTimeout(main, 2000);
    // await frame.sendFile("/home/henry/screenshot.png");
    // await frame.sendFile("/home/henry/Selection_201.png");
}

async function start() {
    frame.open().then((res) => {
        if (res === 0) {
            setTimeout(main, 2000);
        }
        else {
            console.log(`Could not open device. Error ${res}`);

        }
    }).catch((err) => {
        console.log(`Error opening device. ${err}`);
    });
}

start();
