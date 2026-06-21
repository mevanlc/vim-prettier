FROM node:20-bookworm

ARG EDITOR_FLAVOR=vim
ARG EDITOR_VERSION=v9.1.2050

ENV DEBIAN_FRONTEND=noninteractive
ENV VIM_EXECUTABLE=/usr/local/bin/editor-under-test

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    autoconf \
    automake \
    ca-certificates \
    curl \
    git \
    libacl1-dev \
    libgpm-dev \
    libncurses-dev \
    make \
    pkg-config \
    python3 \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

RUN set -eux; \
  if [ "$EDITOR_FLAVOR" = "vim" ]; then \
    git clone --depth 1 --branch "$EDITOR_VERSION" https://github.com/vim/vim.git /tmp/vim; \
    cd /tmp/vim; \
    ./configure \
      --prefix=/opt/editor \
      --with-features=huge \
      --enable-multibyte \
      --enable-terminal \
      --without-x \
      --disable-gui \
      --enable-fail-if-missing; \
    make -j"$(nproc)"; \
    make install; \
    ln -s /opt/editor/bin/vim /usr/local/bin/editor-under-test; \
    rm -rf /tmp/vim; \
  elif [ "$EDITOR_FLAVOR" = "nvim" ]; then \
    mkdir -p /opt/editor /tmp/nvim-download; \
    cd /tmp/nvim-download; \
    base_url="https://github.com/neovim/neovim/releases/download/${EDITOR_VERSION}"; \
    curl -fsSLO "${base_url}/nvim-linux-x86_64.tar.gz" \
      || curl -fsSLO "${base_url}/nvim-linux64.tar.gz"; \
    tar -xzf nvim-linux*.tar.gz --strip-components=1 -C /opt/editor; \
    ln -s /opt/editor/bin/nvim /usr/local/bin/editor-under-test; \
    rm -rf /tmp/nvim-download; \
  else \
    printf 'Unsupported EDITOR_FLAVOR: %s\n' "$EDITOR_FLAVOR" >&2; \
    exit 1; \
  fi

WORKDIR /workspace

CMD ["sh", "-lc", "node scripts/vim-version.js && yarn --version && yarn install --frozen-lockfile && yarn test:smoke"]
