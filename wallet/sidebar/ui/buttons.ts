import { html, type MiniHtmlString } from "@spirobel/mininext";

export type ClickHandler = (event: MouseEvent) => unknown;

export function tactileSwitch(
  id: string,
  buttonText: string | MiniHtmlString,
  onclick?: ClickHandler,
  active = false,
) {
  return html`<div
    id="${id}"
    class="tactile-switch ${active ? "active-switch" : ""}"
    onclick=${onclick}
  >
    ${buttonText}<style>
      .tactile-switch {
        border-radius: 3% 10% 6% 16% / 18% 72% 21% 74%;
        height: 30px;
        min-width: 75px;
        margin-right: 7px;
        color: rgba(255, 255, 255, 0.3);
        background-color: #666;
        background-image: linear-gradient(
          to bottom,
          transparent 0px 2px,
          rgba(0, 0, 0, 0.5) 2px 5px,
          transparent 5px 7px,
          rgba(0, 0, 0, 0.5) 7px 10px,
          rgba(0, 0, 0, 0.14) 10px 16px
        );
        outline: 2px solid rgba(102, 102, 102, 0.5);
        display: flex;
        align-items: flex-end;
        justify-content: flex-end;
        padding: 0px 4px;
        box-sizing: border-box;
        font-size: 12px;
        font-weight: bold;
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.45),
          0 15px 25px rgba(0, 0, 0, 0.4);
        cursor: pointer;
        user-select: none;
      }
      .tactile-switch:hover {
        color: rgba(255, 255, 255, 0.9);
      }
      .active-switch {
        color: rgba(255, 255, 255, 0.9);
      }
    </style>
  </div>`;
}
export function actionButton(
  id: string,
  buttonText: string | MiniHtmlString,
  active: boolean = true,
  onclick?: ClickHandler,
) {
  const buttonClass = active ? "action-button" : "inactive-action-button";
  const opacity = active ? 1 : 0.3;
  const cursor = active ? "pointer" : "not-allowed";
  return html`<div id="${id}" class="${buttonClass}" onclick=${onclick}>
    ${buttonText}<style>
      .${buttonClass} {
        border-radius: 3% 10% 6% 16% / 18% 72% 21% 74%;
        height: 30px;
        min-width: 75px;
        margin-right: 7px;
        color: rgba(255, 255, 255, 0.3);
        background-color: #666;
        background-image: linear-gradient(
          to bottom,
          transparent 0px 2px,
          rgba(255, 255, 255, 0.6) 2px 5px,
          transparent 5px 7px,
          rgba(255, 255, 255, 0.5) 7px 10px,
          rgba(0, 0, 0, 0.14) 10px 16px
        );
        outline: 2px solid rgba(102, 102, 102, 0.9);
        display: flex;
        align-items: flex-end;
        justify-content: flex-end;
        padding: 0px 6px 2px 0px;
        box-sizing: border-box;
        font-size: 12px;
        font-weight: bold;
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.45),
          0 15px 25px rgba(0, 0, 0, 0.4);
        cursor: ${cursor};
        user-select: none;
        opacity: ${opacity};
      }
      .action-button:hover {
        color: rgba(255, 255, 255, 0.9);
        outline: 2px solid rgba(255, 255, 255, 0.9);
      }
      .active-action-button {
        color: rgba(255, 255, 255, 0.7);
      }
    </style>
  </div>`;
}
