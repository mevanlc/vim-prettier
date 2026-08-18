if &filetype =~# '\v<graphql>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'graphql',
    \ }
endif
