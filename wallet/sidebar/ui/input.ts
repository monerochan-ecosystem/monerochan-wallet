import { html } from "../../../mininext/mininext";

export function textInput(id: string, placeholder: string) {
  return html`<div class="text-input-block">
    <style>
      .text-input-block {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .text-input-element {
        color: white;
        background: #333;
        width: 280px;
        margin-right: 12px;
        margin-top: 12px;
        font-size: 16px;
        padding: 2px;
      }
      .text-input-element:focus {
        outline: 2px solid #007bff;
        box-shadow: 0 0 5px rgba(0, 123, 255, 0.5);
      }
      .text-input-element::selection {
        background: #007bff;
      }
    </style>
    <input
      type="text"
      id="${id}"
      name="${id}"
      class="text-input-element"
      placeholder="${placeholder}"
    />
  </div>`;
}

export function integerInput(id: string, placeholder: string) {
  return html`<div class="text-input-block">
    <style>
      .text-input-block {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .text-input-element {
        color: white;
        background: #333;
        width: 280px;
        margin-right: 12px;
        margin-top: 12px;
        font-size: 16px;
        padding: 2px;
      }
      .text-input-element:focus {
        outline: none;
        border: 2px solid #007bff;
        box-shadow: 0 0 5px rgba(0, 123, 255, 0.5);
      }
      .text-input-element::selection {
        background: #007bff;
      }
      /* Hide the spin buttons in WebKit browsers */
      input::-webkit-outer-spin-button,
      input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      /* Hide spin buttons in Firefox */
      input[type="number"] {
        -moz-appearance: textfield;
      }
    </style>
    <input
      type="number"
      min="0"
      step="1"
      id="${id}"
      name="${id}"
      class="text-input-element"
      placeholder="${placeholder}"
    />
  </div>`;
}
