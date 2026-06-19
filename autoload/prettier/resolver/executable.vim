let s:ROOT_DIR = fnamemodify(resolve(expand('<sfile>:p')), ':h')
let s:PLUGIN_ROOT_DIR = fnamemodify(s:ROOT_DIR, ':h:h:h')

function! s:NormalizePath(path) abort
  let l:path = substitute(a:path, '\\ ', ' ', 'g')
  return substitute(resolve(fnamemodify(l:path, ':p')), '\\', '/', 'g')
endfunction

function! prettier#resolver#executable#isUnderPluginRoot(path) abort
  if type(a:path) != type('') || a:path ==# ''
    return 0
  endif

  if a:path !~# '^\(/\|[A-Za-z]:[/\\]\)'
    return 0
  endif

  let l:plugin_root = s:NormalizePath(s:PLUGIN_ROOT_DIR)
  let l:path = s:NormalizePath(a:path)
  return l:path ==# l:plugin_root || stridx(l:path, l:plugin_root . '/') ==# 0
endfunction

" By default we will search for the following
" => user defined prettier cli path from vim configuration file
" => locally installed prettier from current buffer's parent folders
" => locally installed prettier from Vim cwd parent folders
" => globally installed prettier
" => vim-prettier prettier installation
" => if all fails suggest install
function! prettier#resolver#executable#getPath() abort
  let l:user_defined_exec_path = fnamemodify(g:prettier#exec_cmd_path, ':p')
  if executable(l:user_defined_exec_path)
    return l:user_defined_exec_path
  endif

  let l:bufferPath = expand('%:p')
  if l:bufferPath !=# ''
    let l:bufferDir = fnamemodify(l:bufferPath, ':h')
    if isdirectory(l:bufferDir)
      let l:bufferLocalExec = s:ResolveExecutable(l:bufferDir)
      if executable(l:bufferLocalExec)
        return fnameescape(l:bufferLocalExec)
      endif
    endif
  endif

  let l:localExec = s:ResolveExecutable(getcwd())
  if executable(l:localExec)
    return fnameescape(l:localExec)
  endif

  let l:globalExec = s:ResolveExecutable()
  if executable(l:globalExec)
    return fnameescape(l:globalExec)
  endif

  let l:pluginExec = s:ResolveExecutable(s:ROOT_DIR)
  if executable(l:pluginExec)
    return fnameescape(l:pluginExec)
  endif

  return -1
endfunction

function! s:GetExecPath(...) abort
  let l:rootDir = a:0 > 0 ? a:1 : -1
  let l:dir = l:rootDir != -1 ? l:rootDir . '/.bin/' : ''
  let l:path = l:dir . get(b:, 'prettier_exec_cmd', 'prettier')
  if executable(l:path)
    return l:path
  else
    return l:dir . 'prettier'
  endif
endfunction

" Searches ancestral node_modules directories for an executable prettier.
function! s:TraverseAncestorDirSearch(rootDir) abort
  let l:root = a:rootDir
  let l:dir = 'node_modules'

  while 1
    let l:searchDir = l:root . '/' . l:dir
    if isdirectory(l:searchDir)
      let l:exec = s:GetExecPath(l:searchDir)
      if executable(l:exec)
        return l:exec
      endif
    endif

    let l:parent = fnamemodify(l:root, ':h')
    if l:parent == l:root
      return -1
    endif

    let l:root = l:parent
  endwhile
endfunction

function! s:ResolveExecutable(...) abort
  let l:rootDir = a:0 > 0 ? a:1 : 0
  let l:exec = '.'

  if isdirectory(l:rootDir)
    let l:exec = s:TraverseAncestorDirSearch(l:rootDir)
  else
    let l:exec = s:GetExecPath()
  endif

  return l:exec
endfunction
