if &filetype =~# '\v<ruby>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'ruby',
    \ }
endif
