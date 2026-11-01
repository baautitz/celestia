import * as React from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group"

/** Campo de senha com o botão de olho para mostrar e esconder o que foi digitado. */
function PasswordInput({ disabled, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visivel, setVisivel] = React.useState(false)
  return (
    <InputGroup data-disabled={disabled || undefined}>
      <InputGroupInput type={visivel ? "text" : "password"} disabled={disabled} {...props} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={visivel ? "Esconder senha" : "Mostrar senha"}
          aria-pressed={visivel}
          disabled={disabled}
          onClick={() => setVisivel((v) => !v)}
        >
          {visivel ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export { PasswordInput }
