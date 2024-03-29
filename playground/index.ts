import { RiveSprite } from "../src";

console.log(
  new RiveSprite({
    asset: "https://cdn.rive.app/animations/vehicles.riv",
    animation: "car",
    autoPlay: true,
    debug: true,
    onReady: () => {
      console.log("Ready");
    },
  }),
);
