set shell := ["zsh", "-cu"]

dev:
    env PATH=/opt/homebrew/opt/node@26/bin:$PATH npm run dev

test:
    env PATH=/opt/homebrew/opt/node@26/bin:$PATH npm test

build:
    env PATH=/opt/homebrew/opt/node@26/bin:$PATH npm run build
