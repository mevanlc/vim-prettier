if &filetype =~# '\v<vue>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'vue',
    \ }
endif
