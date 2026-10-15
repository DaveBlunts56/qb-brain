import Phaser from "phaser";
import { TEAMS } from "../../core/data/teams";
import { registerPixelFont } from "../art/font";
import { makeMiscTextures, makeTeamSheet, SKIN_TONES } from "../art/sprites";

/** Generates every texture the game uses (no image files are loaded). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    registerPixelFont(this);
    makeMiscTextures(this);
    for (const t of TEAMS) for (let s = 0; s < SKIN_TONES.length; s++) makeTeamSheet(this, t.id, t.colors, s);
    this.scene.start("title");
  }
}
