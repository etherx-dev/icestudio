'use strict';

angular.module('icestudio')
  .service('compiler', function(common,
                                nodeSha1,
                                _package) {

    this.generate = function(target, project, opt) {
      var code = '';
      switch(target) {
        case 'verilog':
          code += header('//');
          code += '`default_nettype none\n';
          code += verilogCompiler('main', project, opt);
          break;
        case 'pcf':
          code += header('#');
          code += pcfCompiler(project, opt);
          break;
        case 'testbench':
          code += header('//');
          code += testbenchCompiler(project);
          break;
        case 'gtkwave':
          code += header('[*]');
          code += gtkwaveCompiler(project);
          break;
        default:
          code += '';
      }
      return code;
    };

    function header(comment) {
      var header = '';
      var date = new Date();
      header += comment + ' Code generated by Icestudio ' + _package.version + '\n';
      header += comment + ' ' + date.toUTCString() + '\n';
      header += '\n';
      return header;
    }

    function digestId(id) {
      if (id.indexOf('-') !== -1) {
        id = nodeSha1(id).toString();
      }
      return 'v' + id.substring(0, 6);
    }

    function module(data) {
      var code = '';
      if (data && data.name && data.ports) {

        // Header

        code += '\nmodule ' + data.name;

        //-- Parameters

        var params = [];
        for (var p in data.params) {
          if (data.params[p] instanceof Object) {
            params.push(' parameter ' + data.params[p].name + ' = ' + (data.params[p].value ? data.params[p].value : '0'));
          }
        }

        if (params.length > 0) {
          code += ' #(\n';
          code += params.join(',\n');
          code += '\n)';
        }

        //-- Ports

        var ports = [];
        for (var i in data.ports.in) {
          var _in = data.ports.in[i];
          ports.push(' input ' + (_in.range ? (_in.range + ' ') : '') + _in.name);
        }
        for (var o in data.ports.out) {
          var _out = data.ports.out[o];
          ports.push(' output ' + (_out.range ? (_out.range + ' ') : '') + _out.name);
        }

        if (ports.length > 0) {
          code += ' (\n';
          code += ports.join(',\n');
          code += '\n)';
        }

        code += ';\n';

        // Content

        if (data.content) {

          var content = data.content.split('\n');

          content.forEach(function (element, index, array) {
            array[index] = ' ' + element;
          });

          code += content.join('\n');
        }

        // Footer

        code += '\nendmodule\n';
      }

      return code;
    }

    function getParams(project) {
      var params = [];
      var graph = project.design.graph;

      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.constant') {
          params.push({
            name: digestId(block.id),
            value: block.data.value
          });
        }
      }

      return params;
    }

    function getPorts(project) {
      var ports = {
        in: [],
        out: []
      };
      var graph = project.design.graph;

      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.input') {
          ports.in.push({
            name: digestId(block.id),
            range: block.data.range ? block.data.range : ''
          });
        }
        else if (block.type === 'basic.output') {
          ports.out.push({
            name: digestId(block.id),
            range: block.data.range ? block.data.range : ''
          });
        }
      }

      return ports;
    }

    function getContent(name, project) {
      var i, j, w;
      var content = [];
      var graph = project.design.graph;
      var connections = {
        localparam: [],
        wire: [],
        assign: []
      };

      for (w in graph.wires) {
        var wire = graph.wires[w];
        if (wire.source.port === 'constant-out') {
          // Local Parameters
          var constantBlock = findBlock(wire.source.block, graph);
          var paramValue = digestId(constantBlock.id);
          if (paramValue) {
            connections.localparam.push('localparam p' + w + ' = ' + paramValue  + ';');
          }
        }
        else {
          // Wires
          var range = wire.size ? ' [0:' + (wire.size-1) +'] ' : ' ';
          connections.wire.push('wire' + range + 'w' + w + ';');
        }
        // Assignations
        for (i in graph.blocks) {
          var block = graph.blocks[i];
          if (block.type === 'basic.input') {
            if (wire.source.block === block.id) {
              connections.assign.push('assign w' + w + ' = ' + digestId(block.id) + ';');
            }
          }
          else if (block.type === 'basic.output') {
            if (wire.target.block === block.id) {
              if (wire.source.port === 'constant-out') {
                // connections.assign.push('assign ' + digestId(block.id) + ' = p' + w + ';');
              }
              else {
                connections.assign.push('assign ' + digestId(block.id) + ' = w' + w + ';');
              }
            }
          }
        }
      }

      content = content.concat(connections.localparam);
      content = content.concat(connections.wire);
      content = content.concat(connections.assign);

      // Wires Connections

      var numWires = graph.wires.length;
      for (i = 1; i < numWires; i++) {
        for (j = 0; j < i; j++) {
          var wi = graph.wires[i];
          var wj = graph.wires[j];
          if (wi.source.block === wj.source.block &&
              wi.source.port === wj.source.port &&
              wi.source.port !== 'constant-out') {
            content.push('assign w' + i + ' = w' + j + ';');
          }
        }
      }

      // Block instances

      content = content.concat(getInstances(name, project.design.graph));

      return content.join('\n');
    }

    function getInstances(name, graph) {
      var w, wire;
      var instances = [];
      var blocks = graph.blocks;

      for (var b in blocks) {
        var block = blocks[b];

        if (block.type !== 'basic.input' &&
            block.type !== 'basic.output' &&
            block.type !== 'basic.constant' &&
            block.type !== 'basic.info') {

          // Header

          var instance;
          if (block.type === 'basic.code') {
            instance = name + '_' + digestId(block.id);
          }
          else {
            instance = digestId(block.type);
          }

          //-- Parameters

          var params = [];
          for (w in graph.wires) {
            wire = graph.wires[w];
            if ((block.id === wire.target.block) &&
                (wire.source.port === 'constant-out')) {
              var paramName = wire.target.port;
              if (block.type !== 'basic.code') {
                paramName = digestId(paramName);
              }
              var param = '';
              param += ' .' + paramName;
              param += '(p' + w + ')';
              params.push(param);
            }
          }

          if (params.length > 0) {
            instance += ' #(\n' + params.join(',\n') + '\n)';
          }

          //-- Instance name

          instance += ' ' +  digestId(block.id);

          //-- Ports

          var ports = [];
          var portsNames = [];
          for (w in graph.wires) {
            wire = graph.wires[w];
            if (block.id === wire.source.block) {
              connectPort(wire.source.port, portsNames, ports, block);
            }
            if (block.id === wire.target.block) {
              if (wire.source.port !== 'constant-out') {
                connectPort(wire.target.port, portsNames, ports, block);
              }
            }
          }

          instance += ' (\n' + ports.join(',\n') + '\n);';

          if (instance) {
            instances.push(instance);
          }
        }
      }

      function connectPort(portName, portsNames, ports, block) {
        if (portName) {
          if (block.type !== 'basic.code') {
            portName = digestId(portName);
          }
          if (portsNames.indexOf(portName) === -1) {
            portsNames.push(portName);
            var port = '';
            port += ' .' + portName;
            port += '(w' + w + ')';
            ports.push(port);
          }
        }
      }

      return instances;
    }

    function findBlock(id, graph) {
      for (var b in graph.blocks) {
        if (graph.blocks[b].id === id) {
          return graph.blocks[b];
        }
      }
      return null;
    }

    this.getInitPorts = getInitPorts;
    function getInitPorts(project) {
      // Find not connected input wire ports to initialize

      var i, j;
      var initPorts = [];
      var blocks = project.design.graph.blocks;
      var dependencies = project.dependencies;

      // Find all not connected input ports:
      // - Code blocks
      // - Generic blocks
      for (i in blocks) {
        var block = blocks[i];
        if (block) {
          if (block.type === 'basic.code') {
            // Code block
            for (j in block.data.ports.in) {
              var inPort = block.data.ports.in[j];
              if (inPort.default && inPort.default.apply) {
                initPorts.push({
                  block: block.id,
                  port: inPort.name,
                  name: inPort.default.port,
                  pin: inPort.default.pin
                });
              }
            }
            // block.data.ports.in
          }
          else if (!block.type.startsWith('basic.')) {
            // Generic block
            var genericBlock = dependencies[block.type];
            var subBlocks = genericBlock.design.graph.blocks;
            for (j in subBlocks) {
              var subBlock = subBlocks[j];
              if (subBlock.type === 'basic.input' &&
                  subBlock.data.default && subBlock.data.default.apply) {
                initPorts.push({
                  block: block.id,
                  port: subBlock.id,
                  name: subBlock.data.default.port,
                  pin: subBlock.data.default.pin
                });
              }
            }
          }
        }
      }

      return initPorts;
    }

    this.getInitPins = getInitPins;
    function getInitPins(project) {
      // Find not used output pins to initialize

      var i;
      var initPins = [];
      var usedPins = [];
      var blocks = project.design.graph.blocks;

      // Find all set output pins
      for (i in blocks) {
        var block = blocks[i];
        if (block.type === 'basic.output') {
          for (var p in block.data.pins) {
            usedPins.push(block.data.virtual ? '' : block.data.pins[p].value);
          }
        }
      }

      // Filter pins defined in rules
      var allInitPins = common.selectedBoard.rules.output;
      for (i in allInitPins) {
        if (usedPins.indexOf(allInitPins[i].pin) === -1) {
          initPins.push(allInitPins[i]);
        }
      }

      return initPins;
    }

    function verilogCompiler(name, project, opt) {
      var i, data, block, code = '';
      opt = opt || {};

      if (project &&
          project.design &&
          project.design.graph) {

        var blocks = project.design.graph.blocks;
        var dependencies = project.dependencies;

        // Main module

        if (name) {

          // Initialize input ports

          if (name === 'main' && opt.boardRules) {

            var initPorts = opt.initPorts || getInitPorts(project);
            for (i in initPorts) {
              var initPort = initPorts[i];

              // Find existing input block with the initPort value
              var found = false;
              var source = {
                block: initPort.name,
                port: 'out'
              };
              for (i in blocks) {
                block = blocks[i];
                if (block.type === 'basic.input' &&
                    !block.data.range &&
                    !block.data.virtual &&
                    initPort.pin === block.data.pins[0].value) {
                  found = true;
                  source.block = block.id;
                  break;
                }
              }

              if (!found) {
                // Add imaginary input block with the initPort value
                project.design.graph.blocks.push({
                  id: initPort.name,
                  type: 'basic.input',
                  data: {
                    name: initPort.name,
                    pins: [
                      {
                        index: '0',
                        value: initPort.pin
                      }
                    ],
                    virtual: false
                  }
                });
              }

              // Add imaginary wire between the input block and the initPort
              project.design.graph.wires.push({
                source: {
                  block: source.block,
                  port: source.port
                },
                target: {
                  block: initPort.block,
                  port: initPort.port
                }
              });
            }
          }

          var params = getParams(project);
          var ports = getPorts(project);
          var content = getContent(name, project);

          // Initialize output pins

          if (name === 'main' && opt.boardRules) {

            // Initialize output pins

            var initPins = opt.initPins || getInitPins(project);
            var n = initPins.length;

            if (n > 0) {
              // Declare m port
              ports.out.push({
                name: 'vinit',
                range: '[0:' + (n-1) + ']'
              });
              // Generate port value
              var value = n.toString() + '\'b';
              for (i in initPins) {
                value += initPins[i].bit;
              }
              // Assign m port
              content += '\nassign vinit = ' + value + ';';
            }
          }

          data = {
            name: name,
            params: params,
            ports: ports,
            content: content
          };
          code += module(data);
        }

        // Dependencies modules

        for (var d in dependencies) {
          code += verilogCompiler(digestId(d), dependencies[d]);
        }

        // Code modules

        for (i in blocks) {
          block = blocks[i];
          if (block) {
            if (block.type === 'basic.code') {
              data = {
                name: name + '_' + digestId(block.id),
                params: block.data.params,
                ports: block.data.ports,
                content: block.data.code.replace(/\n+/g, '\n').replace(/\n$/g, '')
              };
              code += module(data);
            }
          }
        }
      }

      return code;
    }

    function pcfCompiler(project, opt) {
      var i, j, block, pin, value, code = '';
      var blocks = project.design.graph.blocks;
      opt = opt || {};

      for (i in blocks) {
        block = blocks[i];
        if (block.type === 'basic.input' ||
            block.type === 'basic.output') {

          if (block.data.pins.length > 1) {
            for (var p in block.data.pins) {
              pin = block.data.pins[p];
              value = block.data.virtual ? '' : pin.value;
              code += 'set_io ';
              code += digestId(block.id);
              code += '[' + pin.index + '] ';
              code += value;
              code += '\n';
            }
          }
          else if (block.data.pins.length > 0) {
            pin = block.data.pins[0];
            value = block.data.virtual ? '' : pin.value;
            code += 'set_io ';
            code += digestId(block.id);
            code += ' ';
            code += value;
            code += '\n';
          }
        }
      }

      if (opt.boardRules) {
        // Declare init input ports

        var used = [];
        var initPorts = opt.initPorts || getInitPorts(project);
        for (i in initPorts) {
          var initPort = initPorts[i];
          if (used.indexOf(initPort.pin) !== -1) {
            break;
          }
          used.push(initPort.pin);

          // Find existing input block with the initPort value
          var found = false;
          for (j in blocks) {
            block = blocks[j];
            if (block.type === 'basic.input' &&
            !block.data.range &&
            !block.data.virtual &&
            initPort.pin === block.data.pins[0].value) {
              found = true;
              used.push(initPort.pin);
              break;
            }
          }

          if (!found) {
            code += 'set_io v';
            code += initPorts[i].name;
            code += ' ';
            code += initPorts[i].pin;
            code += '\n';
          }
        }

        // Declare init output pins

        var initPins = opt.initPins || getInitPins(project);
        if (initPins.length > 1) {
          for (i in initPins) {
            code += 'set_io vinit[' + i + '] ';
            code += initPins[i].pin;
            code += '\n';
          }
        }
        else if (initPins.length > 0) {
          code += 'set_io vinit ';
          code += initPins[0].pin;
          code += '\n';
        }
      }

      return code;
    }

    function testbenchCompiler(project) {
      var i, o, p;
      var code = '';

      code += '// Testbench template\n\n';

      code += '`default_nettype none\n';
      code += '`define DUMPSTR(x) `"x.vcd`"\n';
      code += '`timescale 10 ns / 1 ns\n\n';

      var ports = { in: [], out: [] };
      var content = '\n';

      content += '// Simulation time: 100ns (10 * 10ns)\n';
      content += 'parameter DURATION = 10;\n';

      // Parameters
      var _params = [];
      var params = mainParams(project);
      if (params.length > 0) {
        content += '\n// TODO: edit the module parameters here\n';
        content += '// e.g. localparam constant_value = 1;\n';
        for (p in params) {
          content += 'localparam ' + params[p].name + ' = ' + params[p].value + ';\n';
          _params.push(' .' + params[p].id + '(' + params[p].name + ')');
        }
      }

      // Input/Output
      var io = mainIO(project);
      var input = io.input;
      var output = io.output;
      content += '\n// Input/Output\n';
      var _ports = [];
      for (i in input) {
        content += 'reg ' + (input[i].range ? input[i].range + ' ': '') + input[i].name + ';\n';
        _ports.push(' .' + input[i].id + '(' + input[i].name + ')');
      }
      for (o in output) {
        content += 'wire ' + (output[o].range ? output[o].range + ' ': '') + output[o].name + ';\n';
        _ports.push(' .' + output[o].id + '(' + output[o].name + ')');
      }

      // Module instance
      content += '\n// Module instance\n';
      content += 'main';

      //-- Parameters
      if (_params.length > 0) {
        content += ' #(\n';
        content += _params.join(',\n');
        content += '\n)';
      }

      content += ' MAIN';

      //-- Ports
      if (_ports.length > 0) {
        content += ' (\n';
        content += _ports.join(',\n');
        content += '\n)';
      }

      content += ';\n';

      // Clock signal
      var hasClk = false;
      for (i in input) {
        if (input[i].name.toLowerCase() === 'clk') {
          hasClk = true;
          break;
        }
      }
      if (hasClk) {
        content += '\n// Clock signal\n';
        content += 'always #0.5 clk = ~clk;\n';
      }

      content += '\ninitial begin\n';
      content += ' // File were to store the simulation results\n';
      content += ' $dumpfile(`DUMPSTR(`VCD_OUTPUT));\n';
      content += ' $dumpvars(0, main_tb);\n\n';
      content += ' // TODO: initialize the registers here\n';
      content += ' // e.g. value = 1;\n';
      content += ' // e.g. #2 value = 0;\n';
      for (i in input) {
        content += ' ' + input[i].name + ' = 0;\n';
      }
      content += '\n';
      content += ' #(DURATION) $display("End of simulation");\n';
      content += ' $finish;\n';
      content += 'end\n';

      var data = {
        name: 'main_tb',
        ports: ports,
        content: content
      };
      code += module(data);

      return code;
    }

    function gtkwaveCompiler(project) {
      var code = '';

      var io = mainIO(project);
      var input = io.input;
      var output = io.output;

      for (var i in input) {
        code += 'main_tb.' + input[i].name + (input[i].range ? input[i].range: '') + '\n';
      }
      for (var o in output) {
        code += 'main_tb.' + output[o].name + (output[o].range ? output[o].range: '') + '\n';
      }

      return code;
    }

    function mainIO(project) {
      var input = [];
      var output = [];
      var inputUnnamed = 0;
      var outputUnnamed = 0;
      var graph = project.design.graph;
      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.input') {
          if (block.data.name) {
            input.push({
              id: digestId(block.id),
              name: block.data.name.replace(/ /g, '_'),
              range: block.data.range
            });
          }
          else {
            input.push({
              id: digestId(block.id),
              name: inputUnnamed.toString(),
            });
            inputUnnamed += 1;
          }
        }
        else if (block.type === 'basic.output') {
          if (block.data.name) {
            output.push({
              id: digestId(block.id),
              name: block.data.name.replace(/ /g, '_'),
              range: block.data.range
            });
          }
          else {
            output.push({
              id: digestId(block.id),
              name: outputUnnamed.toString()
            });
            outputUnnamed += 1;
          }
        }
      }

      return {
        input: input,
        output: output
      };
    }

    function mainParams(project) {
      var params = [];
      var paramsUnnamed = 0;
      var graph = project.design.graph;
      for (var i in graph.blocks) {
        var block = graph.blocks[i];
        if (block.type === 'basic.constant') {
          if (!block.data.local) {
            if (block.data.name) {
              params.push({
                id: digestId(block.id),
                name: 'constant_' + block.data.name.replace(/ /g, '_'),
                value: block.data.value
              });
            }
            else {
              params.push({
                id: digestId(block.id),
                name: 'constant_' + paramsUnnamed.toString(),
                value: block.data.value
              });
              paramsUnnamed += 1;
            }
          }
        }
      }

      return params;
    }

  });
