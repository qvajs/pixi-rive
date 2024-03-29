import Rive, {
  type Artboard,
  type File,
  type RiveCanvas,
  type WrappedRenderer,
  type LinearAnimationInstance,
  type StateMachineInstance,
  type SMIInput,
  type Mat2D,
} from "@rive-app/webgl-advanced";
import {
  Assets,
  BrowserAdapter,
  ExtensionType,
  LoaderParserPriority,
  Sprite,
  Texture,
  checkExtension,
  extensions,
} from "pixi.js";

extensions.add({
  name: "loadRive",
  extension: {
    type: ExtensionType.LoadParser,
    priority: LoaderParserPriority.High,
  },
  test(url: string) {
    // checkDataUrl(url, 'mime/type');
    return checkExtension(url, ".riv");
  },
  async load(url: string) {
    const response = await BrowserAdapter.fetch(url);
    return new Uint8Array(await response.arrayBuffer());
  },
});

export enum Fit {
  Cover = "cover",
  Contain = "contain",
  Fill = "fill",
  FitWidth = "fitWidth",
  FitHeight = "fitHeight",
  None = "none",
  ScaleDown = "scaleDown",
}

export enum Alignment {
  Center = "center",
  TopLeft = "topLeft",
  TopCenter = "topCenter",
  TopRight = "topRight",
  CenterLeft = "centerLeft",
  CenterRight = "centerRight",
  BottomLeft = "bottomLeft",
  BottomCenter = "bottomCenter",
  BottomRight = "bottomRight",
}

let WASM_PATH = "https://unpkg.com/@rive-app/webgl-advanced@2.10.4/rive.wasm";

const riveApp = Rive({ locateFile: () => WASM_PATH });
export function setWasmPath(path: string): void {
  WASM_PATH = path;
}

type RiveOptions = {
  asset: string | Uint8Array;
  debug?: boolean;
  autoPlay?: boolean;
  interactive?: boolean;
  artboard?: string;
  animation?: string | string[];
  stateMachine?: string | string[];
  /** 帧变换时 */
  onStateChange?: (states: string[]) => void;
  /** Rive 对象 Ready 时 */
  onReady?: (rive: RiveCanvas) => void;
};

export class RiveSprite extends Sprite {
  private _animFrame = 0;
  private _lastTime = 0;
  private _enabled = false;
  private _rive?: RiveCanvas;
  private _file?: File;
  private _aligned?: Mat2D;
  private _renderer?: WrappedRenderer;
  private _canvas?: OffscreenCanvas | HTMLCanvasElement;
  maxWidth = 0;
  maxHeight = 0;
  fit: Fit = Fit.Contain;
  align: Alignment = Alignment.Center;
  animations: LinearAnimationInstance[] = [];
  stateMachines: StateMachineInstance[] = [];
  inputFields: Map<string, SMIInput> = new Map();
  onStateChange?: (states: string[]) => void;
  artboard?: Artboard;

  constructor(options: RiveOptions) {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 100;
    tempCanvas.height = 100;

    super({ texture: Texture.from(tempCanvas) });
    this._canvas = tempCanvas;

    this.onStateChange = options.onStateChange;
    this.initEvents(options?.interactive ?? false);
    this.initRive(options.asset).then(() => {
      this.loadArtboard(options.artboard);
      this.loadStateMachine(options.stateMachine);
      this.playAnimation(options.animation);
      if (options.autoPlay) {
        this.enable();
      } else {
        this._rive?.requestAnimationFrame(this.renderLoop);
      }
      if (options.onReady) {
        this._rive && options.onReady(this._rive);
      }
    });
  }

  /**
   * 加载 Rive 文件, 初始化对象
   */
  private async initRive(riv: string | Uint8Array) {
    const asset = typeof riv === "string" ? await Assets.load(riv) : riv;
    this._rive = await riveApp;
    this._file = await this._rive.load(asset);
    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    this._renderer = this._rive.makeRenderer(this._canvas!);
  }

  private initEvents(interactive: boolean) {
    if (!interactive) {
      return;
    }
    // this.cursor = 'pointer'
    this.eventMode = "static";
    this.addEventListener("pointerdown", (e) => {
      const point = this.translatePoint(e.global);
      this.stateMachines.map((m) => m.pointerDown(...point));
    });
    this.addEventListener("pointerup", (e) => {
      const point = this.translatePoint(e.global);
      this.stateMachines.map((m) => m.pointerUp(...point));
    });
    this.addEventListener("pointermove", (e) => {
      const point = this.translatePoint(e.global);
      this.stateMachines.map((m) => m.pointerMove(...point));
    });
  }

  enable() {
    this._enabled = true;
    if (!this._animFrame && this._rive) {
      this._animFrame = this._rive.requestAnimationFrame(this.renderLoop);
    }
  }

  disable() {
    this._enabled = false;
    if (this._animFrame && this._rive) {
      this._rive.cancelAnimationFrame(this._animFrame);
      this._animFrame = 0;
    }
  }

  loadArtboard(artboard: string | undefined) {
    if (this.artboard) {
      this.artboard.delete();
    }
    if (this._file && this._canvas) {
      this.artboard = artboard
        ? this._file.artboardByName(artboard)
        : this._file.defaultArtboard();
      this.texture = Texture.from(this._canvas);
    }
    this.updateSize();
  }

  /**
   * 加载状态机 & 初始化输入字段
   */
  loadStateMachine(machines: string | string[] = []) {
    if (!this.artboard || !this._rive) {
      return;
    }
    let machineNames = typeof machines === "string" ? [machines] : machines;
    if (machines.length === 0) {
      const defaultMachine = this.artboard?.stateMachineByIndex(0);
      if (defaultMachine) {
        machineNames = [defaultMachine.name];
      }
    }
    for (const name of machineNames) {
      const machine = this.artboard.stateMachineByName(name);
      if (machine) {
        this.unloadStateMachine(name);
        this.stateMachines.push(
          new this._rive.StateMachineInstance(machine, this.artboard),
        );
      }
    }
    // 初始化输入
    this.initInputFields();
  }

  unloadStateMachine(name: string) {
    this.stateMachines = this.stateMachines.filter((machine) => {
      if (machine.name === name) {
        machine.delete();
        return false;
      }
      return true;
    });
  }

  playAnimation(animations: string | string[] = []) {
    if (!this.artboard && !this._rive) {
      return;
    }
    let animationNames =
      typeof animations === "string" ? [animations] : animations;

    // 如果 animations 为空且没有状态机，则尝试加载默认动画
    if (animationNames.length === 0 && this.stateMachines.length === 0) {
      const defaultAnimation = this.artboard?.animationByIndex(0);
      if (defaultAnimation) {
        animationNames = [defaultAnimation.name];
      }
    }

    for (const name of animationNames) {
      const animation = this.artboard?.animationByName(name);
      if (animation && this.artboard) {
        this.stopAnimation(name);
        // biome-ignore lint/style/noNonNullAssertion: <explanation>
        this.animations.push(
          new this._rive!.LinearAnimationInstance(animation, this.artboard),
        );
      }
    }
  }

  stopAnimation(name: string) {
    this.animations = this.animations.filter((animation) => {
      if (animation.name === name) {
        animation.delete();
        return false;
      }
      return true;
    });
  }

  getAvailableArtboards() {
    const available: string[] = [];
    if (this._file) {
      for (let i = 0; i < this._file.artboardCount(); i++) {
        available[i] = this._file.artboardByIndex(i).name;
      }
    }
    return available;
  }

  getAvailableStateMachines() {
    const available: string[] = [];
    if (this.artboard) {
      for (let i = 0; i < this.artboard.stateMachineCount(); i++) {
        available[i] = this.artboard.stateMachineByIndex(i).name;
      }
    }
    return available;
  }

  getAvailableAnimations() {
    const available: string[] = [];
    if (this.artboard) {
      for (let i = 0; i < this.artboard.animationCount(); i++) {
        available[i] = this.artboard.animationByIndex(i).name;
      }
    }
    return available;
  }

  updateSize() {
    if (this.artboard && this._rive && this._renderer) {
      const bounds = this.artboard.bounds;
      const { minX, minY, maxX, maxY } = bounds;
      const width = maxX - minX;
      const height = maxY - minY;
      const maxWidth = this.maxWidth || width;
      const maxHeight = this.maxHeight || height;
      const fit = this._rive.Fit[this.fit];
      const align = this._rive.Alignment[this.align];
      const frame = { minX: 0, minY: 0, maxX: maxWidth, maxY: maxHeight };
      this._aligned = this._rive?.computeAlignment(fit, align, frame, bounds);
      this._renderer.align(fit, align, frame, bounds);
      if (this._canvas) {
        this._canvas.width = maxWidth;
        this._canvas.height = maxHeight;
      }
      this.texture.source.update();
    }
  }

  private translatePoint(global: { x: number; y: number }): [number, number] {
    const { x, y } = this.toLocal(global);
    const { tx, ty, xx, yy } = this._aligned || { tx: 0, ty: 0, xx: 1, yy: 1 };
    return [(x - tx) / xx, (y - ty) / yy];
  }

  /**
   * 帧循环，PIXI 8 中，使用 this.onRender 来代替
   */
  private renderLoop = (time: number) => {
    if (!this._lastTime) {
      this._lastTime = time;
    }
    const elapsedTime = (time - this._lastTime) / 1000;
    this._lastTime = time;
    if (this.artboard && this._renderer) {
      this.advanceStateMachines(elapsedTime);
      this.advanceAnimations(elapsedTime);
      this.artboard.advance(elapsedTime);
      this._renderer.clear();
      this._renderer.save();
      this.artboard.draw(this._renderer);
      this._renderer.restore();
      this._renderer.flush();
      this.texture.source.update();
    }
    // FIXME: 增加运行时对齐
    if (this._rive && this._enabled) {
      this._rive.requestAnimationFrame(this.renderLoop);
    }
  };

  /**
   *  更新画板状态机
   * @param elapsed 时间间隔
   */
  private advanceStateMachines(elapsed: number) {
    for (const m of this.stateMachines) {
      m.advance(elapsed);
      if (this.onStateChange && m.stateChangedCount()) {
        const states = [];
        for (let i = 0; i < m.stateChangedCount(); i++) {
          states.push(m.stateChangedNameByIndex(i));
        }
        if (states.length > 0) {
          this.onStateChange(states);
        }
      }
    }
  }

  /**
   * 更新动画
   * @param elapsed 时间间隔
   */
  private advanceAnimations(elapsed: number) {
    for (const a of this.animations) {
      a.advance(elapsed);
      a.apply(1);
    }
  }

  initInputFields() {
    if (this._rive) {
      const { bool, trigger } = this._rive.SMIInput;
      this.inputFields.clear();
      for (const m of this.stateMachines) {
        for (let i = 0; i < m.inputCount(); i++) {
          let field: SMIInput;
          const input = m.input(i);
          if (input.type === bool) {
            field = input.asBool();
          } else if (input.type === trigger) {
            field = input.asTrigger();
          } else {
            field = input.asNumber();
          }
          this.inputFields.set(input.name, field);
        }
      }
    }
  }

  getInputValue(name: string) {
    const input = this.inputFields.get(name);
    return input?.value;
  }

  setInput(name: string, value: number | boolean) {
    const input = this.inputFields.get(name);
    if (input && input.type !== this._rive?.SMIInput.trigger) {
      input.value = value;
    }
  }

  fireTrigger(name: string) {
    const input = this.inputFields.get(name);
    if (input && input.type === this._rive?.SMIInput.trigger) {
      input.fire();
    }
  }

  destroy() {
    super.destroy();
    this.disable();
    this.stateMachines.map((machine) => machine.delete());
    this.animations.map((animation) => animation.delete());
    this.artboard?.delete();
    this._renderer?.delete();
    this._file?.delete();
  }
}
